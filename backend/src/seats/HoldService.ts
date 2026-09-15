import { SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { SeatUnavailableError } from "../domain/errors";
import { isRetryableDbError } from "../resilience/isRetryableDbError";
import { withRetry } from "../resilience/withRetry";
import { Seat } from "../domain/Seat";
import { RedisSeatLock } from "./RedisSeatLock";
import { SeatRepository } from "./SeatRepository";
import { SeatNotFoundError } from "./errors";

export class HoldService {
  constructor(
    private readonly seatRepository: SeatRepository,
    private readonly seatLock: RedisSeatLock = new RedisSeatLock()
  ) {}

  async holdSeats(showId: number, seatIds: number[], userId: number, ttlMinutes: number): Promise<Seat[]> {
    const uniqueSeatIds = [...new Set(seatIds)];

    // Fast pre-check before ever touching Postgres -- see RedisSeatLock for
    // why this can only make a request unnecessarily slow or unnecessarily
    // rejected, never wrongly successful. Fails open on a Redis outage: a
    // cache being unreachable must never take down the ability to hold
    // seats at all, same reasoning as the rate limiter failing open.
    let preLocked: number[] = [];
    try {
      preLocked = await this.seatLock.acquire(uniqueSeatIds, ttlMinutes * 60);
      if (preLocked.length !== uniqueSeatIds.length) {
        const lostSeatId = uniqueSeatIds.find((id) => !preLocked.includes(id))!;
        await this.seatLock.release(preLocked);
        throw new SeatUnavailableError(lostSeatId);
      }
    } catch (error) {
      if (error instanceof SeatUnavailableError) {
        throw error;
      }
      console.error("Seat pre-lock check failed; continuing with the database lock alone:", error);
      preLocked = [];
    }

    // withRetry only retries a transient/connection-level DB failure
    // (isRetryableDbError). SeatUnavailableError/SeatNotFoundError below are
    // never an instance of the Prisma error types that predicate checks
    // for, so a correct 409/404 always propagates on the first attempt.
    try {
      return await withRetry(
        () =>
          prisma.$transaction(async (tx) => {
            const seats = await this.seatRepository.lockForUpdate(tx, showId, uniqueSeatIds);

            if (seats.length !== uniqueSeatIds.length) {
              // Some requested seat doesn't exist, or belongs to a different show.
              throw new SeatNotFoundError();
            }

            const now = new Date();
            // Throws SeatUnavailableError on the first unavailable seat; Prisma
            // rolls back the whole transaction on a throw, so a failed batch
            // never holds even the seats that WERE available (FR-3, all-or-nothing).
            seats.forEach((seat) => seat.holdFor(userId, ttlMinutes, now));

            const holdExpiresAt = seats[0].holdExpiresAt as Date;
            await this.seatRepository.persistHold(tx, uniqueSeatIds, userId, holdExpiresAt);

            return seats;
          }),
        { ...config.resilience, isRetryable: isRetryableDbError }
      );
    } catch (error) {
      // Whatever the reason -- a real conflict Redis didn't know about
      // (e.g. an already-BOOKED seat), or a DB failure that exhausted its
      // retries -- these seats aren't actually held, so the pre-lock must
      // not keep claiming they are.
      await this.seatLock.release(preLocked).catch(() => {});
      throw error;
    }
  }

  // Explicit release -- called when the user cancels checkout (closes the
  // payment widget without paying), rather than waiting for the hold's TTL
  // to lapse. Locked the same way holdSeats is: if the payment webhook is
  // concurrently confirming this exact seat (the payment actually went
  // through a moment before the user clicked cancel), whichever transaction
  // gets the row lock first wins, and the other sees the seat's true
  // resulting state -- there's no window where release could stomp on a
  // just-booked seat, or the confirm path could book a seat that was
  // genuinely released first. A seat not held by this user (already
  // released, expired, or someone else's) is silently skipped rather than
  // erroring -- this is best-effort cleanup, not a claim being enforced.
  async releaseHold(showId: number, seatIds: number[], userId: number): Promise<void> {
    const uniqueSeatIds = [...new Set(seatIds)];

    const released = await withRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const seats = await this.seatRepository.lockForUpdate(tx, showId, uniqueSeatIds);
          const releasable = seats.filter((seat) => seat.status === SeatStatus.HELD && seat.heldById === userId);
          if (releasable.length === 0) {
            return [];
          }
          releasable.forEach((seat) => seat.release());
          const releasedIds = releasable.map((seat) => seat.id);
          await this.seatRepository.persistRelease(tx, releasedIds);
          return releasedIds;
        }),
      { ...config.resilience, isRetryable: isRetryableDbError }
    );

    if (released.length > 0) {
      // Postgres is already correct at this point; a failed Redis cleanup
      // here just leaves a stale pre-lock key that self-expires via its own
      // TTL -- never a correctness problem, so this is deliberately
      // best-effort rather than something that can fail the whole request.
      await this.seatLock.release(released).catch((error: unknown) => {
        console.error("Could not clear the Redis pre-lock after releasing a hold:", error);
      });
    }
  }
}
