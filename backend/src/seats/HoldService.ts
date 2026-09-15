import { SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { isRetryableDbError } from "../resilience/isRetryableDbError";
import { withRetry } from "../resilience/withRetry";
import { Seat } from "../domain/Seat";
import { SeatRepository } from "./SeatRepository";
import { SeatNotFoundError } from "./errors";

export class HoldService {
  constructor(private readonly seatRepository: SeatRepository) {}

  async holdSeats(showId: number, seatIds: number[], userId: number, ttlMinutes: number): Promise<Seat[]> {
    const uniqueSeatIds = [...new Set(seatIds)];

    // withRetry only retries a transient/connection-level DB failure
    // (isRetryableDbError). SeatUnavailableError/SeatNotFoundError below are
    // never an instance of the Prisma error types that predicate checks
    // for, so a correct 409/404 always propagates on the first attempt.
    return withRetry(
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

    await withRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const seats = await this.seatRepository.lockForUpdate(tx, showId, uniqueSeatIds);
          const releasable = seats.filter((seat) => seat.status === SeatStatus.HELD && seat.heldById === userId);
          if (releasable.length === 0) {
            return;
          }
          releasable.forEach((seat) => seat.release());
          await this.seatRepository.persistRelease(
            tx,
            releasable.map((seat) => seat.id)
          );
        }),
      { ...config.resilience, isRetryable: isRetryableDbError }
    );
  }
}
