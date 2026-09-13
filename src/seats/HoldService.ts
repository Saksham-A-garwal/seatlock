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
}
