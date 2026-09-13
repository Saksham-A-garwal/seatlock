import { SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { isRetryableDbError } from "../resilience/isRetryableDbError";
import { withRetry } from "../resilience/withRetry";
import { Booking } from "../domain/Booking";
import { BookingNotFoundError } from "./errors";

export class BookingService {
  async getBookingsForUser(userId: number) {
    return prisma.booking.findMany({
      where: { userId },
      include: {
        show: true,
        bookingSeats: { include: { seat: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async cancelBooking(bookingId: number, userId: number, now: Date = new Date()): Promise<Booking> {
    return withRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const row = await tx.booking.findUnique({
            where: { id: bookingId },
            include: { show: true, bookingSeats: true },
          });

          // "Doesn't exist" and "exists but isn't yours" both come back as
          // the same not-found error -- a user can't distinguish the two by
          // response shape, which is what actually makes the check meaningful.
          if (!row || row.userId !== userId) {
            throw new BookingNotFoundError();
          }

          const booking = new Booking({
            id: row.id,
            userId: row.userId,
            showId: row.showId,
            seatIds: row.bookingSeats.map((bookingSeat) => bookingSeat.seatId),
            totalPrice: row.totalPrice.toNumber(),
            status: row.status,
            confirmedAt: row.confirmedAt,
            cancelledAt: row.cancelledAt,
          });

          // Throws InvalidBookingTransitionError (not CONFIRMED) or
          // CancellationWindowPassedError (<1hr to showtime) -- both from
          // Milestone 1, unit-tested there already.
          booking.cancel(row.show.showtime, now);

          await tx.booking.update({
            where: { id: bookingId },
            data: { status: booking.status, cancelledAt: booking.cancelledAt },
          });

          // No refund call here -- deliberate MVP scope cut (FR-7). The
          // Payment row is untouched too: it stays SUCCEEDED, an accurate
          // record that this booking was paid for and later cancelled.
          await tx.seat.updateMany({
            where: { id: { in: booking.seatIds } },
            data: { status: SeatStatus.AVAILABLE, heldById: null, holdExpiresAt: null },
          });

          return booking;
        }),
      { ...config.resilience, isRetryable: isRetryableDbError }
    );
  }
}
