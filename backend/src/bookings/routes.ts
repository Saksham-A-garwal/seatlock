import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { parsePositiveInt } from "../utils/parsePositiveInt";
import { CancellationWindowPassedError, InvalidBookingTransitionError } from "../domain/errors";
import { generateBookingQrPng } from "./bookingQrCode";
import { BookingService } from "./BookingService";
import { BookingNotConfirmedError, BookingNotFoundError } from "./errors";

export function createBookingsRouter(): Router {
  const router = Router();
  const bookingService = new BookingService();

  router.get(
    "/bookings",
    requireAuth,
    asyncHandler(async (req, res) => {
      const bookings = await bookingService.getBookingsForUser(req.auth!.id);

      res.status(200).json({
        bookings: bookings.map((booking) => ({
          id: booking.id,
          status: booking.status,
          totalPrice: booking.totalPrice.toNumber(),
          createdAt: booking.createdAt,
          confirmedAt: booking.confirmedAt,
          cancelledAt: booking.cancelledAt,
          show: {
            id: booking.show.id,
            movieName: booking.show.movieName,
            venue: booking.show.venue,
            showtime: booking.show.showtime,
          },
          seats: booking.bookingSeats.map((bookingSeat) => ({
            id: bookingSeat.seat.id,
            rowLabel: bookingSeat.seat.rowLabel,
            seatNumber: bookingSeat.seat.seatNumber,
          })),
        })),
      });
    })
  );

  router.get(
    "/bookings/:id/qr",
    requireAuth,
    asyncHandler(async (req, res) => {
      const bookingId = parsePositiveInt(req.params.id);
      if (bookingId === null) {
        res
          .status(400)
          .json({ error: { code: "INVALID_BOOKING_ID", message: "bookingId must be a positive integer" } });
        return;
      }

      try {
        const booking = await bookingService.getConfirmedBookingForOwner(bookingId, req.auth!.id);
        const qrPng = await generateBookingQrPng(booking.id);
        res.status(200).set("Content-Type", "image/png").send(qrPng);
      } catch (error) {
        if (error instanceof BookingNotFoundError) {
          res.status(404).json({ error: { code: "BOOKING_NOT_FOUND", message: error.message } });
          return;
        }
        if (error instanceof BookingNotConfirmedError) {
          res.status(409).json({ error: { code: "BOOKING_NOT_CONFIRMED", message: error.message } });
          return;
        }
        throw error;
      }
    })
  );

  router.post(
    "/bookings/:id/cancel",
    requireAuth,
    asyncHandler(async (req, res) => {
      const bookingId = parsePositiveInt(req.params.id);
      if (bookingId === null) {
        res
          .status(400)
          .json({ error: { code: "INVALID_BOOKING_ID", message: "bookingId must be a positive integer" } });
        return;
      }

      try {
        const booking = await bookingService.cancelBooking(bookingId, req.auth!.id);
        res.status(200).json({
          booking: { id: booking.id, status: booking.status, cancelledAt: booking.cancelledAt },
        });
      } catch (error) {
        if (error instanceof BookingNotFoundError) {
          res.status(404).json({ error: { code: "BOOKING_NOT_FOUND", message: error.message } });
          return;
        }
        if (error instanceof InvalidBookingTransitionError || error instanceof CancellationWindowPassedError) {
          res.status(409).json({ error: { code: "CANCELLATION_NOT_ALLOWED", message: error.message } });
          return;
        }
        throw error;
      }
    })
  );

  return router;
}
