import { describe, expect, it } from "vitest";
import { BookingStatus } from "@prisma/client";
import { Booking } from "./Booking";
import { CancellationWindowPassedError, InvalidBookingTransitionError } from "./errors";

const SHOWTIME = new Date("2026-01-01T20:00:00Z");
const NOW = new Date("2026-01-01T12:00:00Z");

function makeBooking(overrides: Partial<ConstructorParameters<typeof Booking>[0]> = {}): Booking {
  return new Booking({
    id: 1,
    userId: 1,
    showId: 1,
    seatIds: [1, 2],
    totalPrice: 500,
    ...overrides,
  });
}

describe("Booking construction", () => {
  it("defaults to PENDING with no confirmed/cancelled timestamps", () => {
    const booking = makeBooking();
    expect(booking.status).toBe(BookingStatus.PENDING);
    expect(booking.confirmedAt).toBeNull();
    expect(booking.cancelledAt).toBeNull();
  });
});

describe("Booking.confirm", () => {
  it("moves a PENDING booking to CONFIRMED and stamps confirmedAt", () => {
    const booking = makeBooking();
    booking.confirm(NOW);

    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.confirmedAt).toEqual(NOW);
  });

  it("rejects confirming a booking that is already CONFIRMED", () => {
    const booking = makeBooking({ status: BookingStatus.CONFIRMED });
    expect(() => booking.confirm(NOW)).toThrow(InvalidBookingTransitionError);
  });

  it("rejects confirming a booking that is CANCELLED", () => {
    const booking = makeBooking({ status: BookingStatus.CANCELLED });
    expect(() => booking.confirm(NOW)).toThrow(InvalidBookingTransitionError);
  });
});

describe("Booking.cancel", () => {
  it("moves a CONFIRMED booking to CANCELLED when well before showtime", () => {
    const booking = makeBooking({ status: BookingStatus.CONFIRMED });
    booking.cancel(SHOWTIME, NOW);

    expect(booking.status).toBe(BookingStatus.CANCELLED);
    expect(booking.cancelledAt).toEqual(NOW);
  });

  it("rejects cancelling within 1 hour of showtime", () => {
    const booking = makeBooking({ status: BookingStatus.CONFIRMED });
    const tooLate = new Date(SHOWTIME.getTime() - 30 * 60_000);

    expect(() => booking.cancel(SHOWTIME, tooLate)).toThrow(CancellationWindowPassedError);
  });

  it("allows cancelling exactly at the 1 hour cutoff (inclusive, per 'up to 1 hour before')", () => {
    const booking = makeBooking({ status: BookingStatus.CONFIRMED });
    const exactlyCutoff = new Date(SHOWTIME.getTime() - 60 * 60_000);

    booking.cancel(SHOWTIME, exactlyCutoff);
    expect(booking.status).toBe(BookingStatus.CANCELLED);
  });

  it("rejects cancelling one second past the cutoff", () => {
    const booking = makeBooking({ status: BookingStatus.CONFIRMED });
    const justPastCutoff = new Date(SHOWTIME.getTime() - 60 * 60_000 + 1000);

    expect(() => booking.cancel(SHOWTIME, justPastCutoff)).toThrow(CancellationWindowPassedError);
  });

  it("rejects cancelling a booking that is still PENDING", () => {
    const booking = makeBooking({ status: BookingStatus.PENDING });
    expect(() => booking.cancel(SHOWTIME, NOW)).toThrow(InvalidBookingTransitionError);
  });

  it("rejects cancelling a booking that is already CANCELLED", () => {
    const booking = makeBooking({ status: BookingStatus.CANCELLED });
    expect(() => booking.cancel(SHOWTIME, NOW)).toThrow(InvalidBookingTransitionError);
  });
});
