import { afterEach, describe, expect, it } from "vitest";
import { BookingStatus, PaymentStatus, SeatStatus, Show } from "@prisma/client";
import { prisma } from "../db/prisma";
import { CancellationWindowPassedError, InvalidBookingTransitionError } from "../domain/errors";
import { cleanupShow, cleanupUsers, createTestSeat, createTestShow, createTestUser } from "../seats/testHelpers";
import { BookingService } from "./BookingService";
import { BookingNotFoundError } from "./errors";
import { createConfirmedBooking } from "./testHelpers";

describe("BookingService", () => {
  const bookingService = new BookingService();
  let show: Show | undefined;
  let userIds: number[] = [];

  afterEach(async () => {
    if (show) await cleanupShow(show.id);
    show = undefined;
    await cleanupUsers(userIds);
    userIds = [];
  });

  describe("getBookingsForUser", () => {
    it("returns all of a user's bookings with show and seat details, most recent first", async () => {
      show = await createTestShow(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const showId = show.id;
      const seatA = await createTestSeat(showId, { seatNumber: 1 });
      const seatB = await createTestSeat(showId, { seatNumber: 2 });
      const user = await createTestUser();
      userIds = [user.id];

      const older = await createConfirmedBooking({
        showId,
        userId: user.id,
        seatIds: [seatA.id],
        confirmedAt: new Date(Date.now() - 60_000),
      });
      const newer = await createConfirmedBooking({ showId, userId: user.id, seatIds: [seatB.id] });

      const bookings = await bookingService.getBookingsForUser(user.id);

      expect(bookings).toHaveLength(2);
      expect(bookings[0].id).toBe(newer.id);
      expect(bookings[1].id).toBe(older.id);
      expect(bookings[0].show.id).toBe(showId);
      expect(bookings[0].bookingSeats[0].seat.id).toBe(seatB.id);
    });

    it("returns an empty list for a user with no bookings", async () => {
      const user = await createTestUser();
      userIds = [user.id];

      const bookings = await bookingService.getBookingsForUser(user.id);
      expect(bookings).toEqual([]);
    });
  });

  describe("cancelBooking", () => {
    it("cancels a confirmed booking well before showtime and frees the seats", async () => {
      show = await createTestShow(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds = [user.id];
      const booking = await createConfirmedBooking({ showId, userId: user.id, seatIds: [seat.id] });

      const result = await bookingService.cancelBooking(booking.id, user.id);

      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(result.cancelledAt).not.toBeNull();

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking?.status).toBe(BookingStatus.CANCELLED);

      const dbSeat = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(dbSeat?.status).toBe(SeatStatus.AVAILABLE);
      expect(dbSeat?.heldById).toBeNull();
    });

    it("does not touch the associated Payment row (stays SUCCEEDED, no refund)", async () => {
      show = await createTestShow(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const showId = show.id;
      const seat = await createTestSeat(showId, { price: 500 });
      const user = await createTestUser();
      userIds = [user.id];
      const booking = await createConfirmedBooking({ showId, userId: user.id, seatIds: [seat.id], totalPrice: 500 });
      const payment = await prisma.payment.create({
        data: {
          userId: user.id,
          showId,
          seatIds: [seat.id],
          razorpayOrderId: `order_test_${Date.now()}`,
          amount: 500,
          status: PaymentStatus.SUCCEEDED,
          bookingId: booking.id,
        },
      });

      await bookingService.cancelBooking(booking.id, user.id);

      const dbPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(dbPayment?.status).toBe(PaymentStatus.SUCCEEDED);

      await prisma.payment.delete({ where: { id: payment.id } });
    });

    it("rejects cancelling a booking that belongs to a different user", async () => {
      show = await createTestShow(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const owner = await createTestUser();
      const otherUser = await createTestUser();
      userIds = [owner.id, otherUser.id];
      const booking = await createConfirmedBooking({ showId, userId: owner.id, seatIds: [seat.id] });

      await expect(bookingService.cancelBooking(booking.id, otherUser.id)).rejects.toThrow(BookingNotFoundError);

      const dbBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(dbBooking?.status).toBe(BookingStatus.CONFIRMED); // untouched
    });

    it("rejects cancelling a booking that doesn't exist", async () => {
      const user = await createTestUser();
      userIds = [user.id];

      await expect(bookingService.cancelBooking(999_999_999, user.id)).rejects.toThrow(BookingNotFoundError);
    });

    it("rejects cancelling within 1 hour of showtime", async () => {
      show = await createTestShow(new Date(Date.now() + 30 * 60 * 1000)); // showtime in 30 minutes
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds = [user.id];
      const booking = await createConfirmedBooking({ showId, userId: user.id, seatIds: [seat.id] });

      await expect(bookingService.cancelBooking(booking.id, user.id)).rejects.toThrow(
        CancellationWindowPassedError
      );

      const dbSeat = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(dbSeat?.status).toBe(SeatStatus.BOOKED); // untouched
    });

    it("rejects cancelling a booking that is already cancelled", async () => {
      show = await createTestShow(new Date(Date.now() + 24 * 60 * 60 * 1000));
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds = [user.id];
      const booking = await createConfirmedBooking({ showId, userId: user.id, seatIds: [seat.id] });

      await bookingService.cancelBooking(booking.id, user.id);

      await expect(bookingService.cancelBooking(booking.id, user.id)).rejects.toThrow(
        InvalidBookingTransitionError
      );
    });
  });
});
