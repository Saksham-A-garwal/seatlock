import { describe, expect, it } from "vitest";
import { SeatStatus } from "@prisma/client";
import { Seat } from "./Seat";
import { SeatUnavailableError } from "./errors";

const NOW = new Date("2026-01-01T12:00:00Z");

function makeSeat(overrides: Partial<ConstructorParameters<typeof Seat>[0]> = {}): Seat {
  return new Seat({
    id: 1,
    showId: 1,
    rowLabel: "A",
    seatNumber: 1,
    status: SeatStatus.AVAILABLE,
    heldById: null,
    holdExpiresAt: null,
    price: 250,
    ...overrides,
  });
}

describe("Seat.isAvailable", () => {
  it("is available when status is AVAILABLE", () => {
    const seat = makeSeat({ status: SeatStatus.AVAILABLE });
    expect(seat.isAvailable(NOW)).toBe(true);
  });

  it("is available when HELD but the hold has already expired", () => {
    const seat = makeSeat({
      status: SeatStatus.HELD,
      heldById: 5,
      holdExpiresAt: new Date(NOW.getTime() - 1000),
    });
    expect(seat.isAvailable(NOW)).toBe(true);
  });

  it("is not available when HELD with a still-valid expiry", () => {
    const seat = makeSeat({
      status: SeatStatus.HELD,
      heldById: 5,
      holdExpiresAt: new Date(NOW.getTime() + 1000),
    });
    expect(seat.isAvailable(NOW)).toBe(false);
  });

  it("is never available when BOOKED", () => {
    const seat = makeSeat({ status: SeatStatus.BOOKED });
    expect(seat.isAvailable(NOW)).toBe(false);
  });
});

describe("Seat.holdFor", () => {
  it("holds an available seat and sets holder + expiry", () => {
    const seat = makeSeat();
    seat.holdFor(42, 5, NOW);

    expect(seat.status).toBe(SeatStatus.HELD);
    expect(seat.heldById).toBe(42);
    expect(seat.holdExpiresAt).toEqual(new Date(NOW.getTime() + 5 * 60_000));
  });

  it("rejects holding a seat that is BOOKED", () => {
    const seat = makeSeat({ status: SeatStatus.BOOKED });
    expect(() => seat.holdFor(42, 5, NOW)).toThrow(SeatUnavailableError);
  });

  it("rejects holding a seat that is validly HELD by someone else", () => {
    const seat = makeSeat({
      status: SeatStatus.HELD,
      heldById: 1,
      holdExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    expect(() => seat.holdFor(42, 5, NOW)).toThrow(SeatUnavailableError);
  });

  it("allows re-holding a seat whose previous hold has expired", () => {
    const seat = makeSeat({
      status: SeatStatus.HELD,
      heldById: 1,
      holdExpiresAt: new Date(NOW.getTime() - 1000),
    });
    seat.holdFor(42, 5, NOW);
    expect(seat.heldById).toBe(42);
  });
});

describe("Seat.release", () => {
  it("resets a held seat back to available", () => {
    const seat = makeSeat({
      status: SeatStatus.HELD,
      heldById: 1,
      holdExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    seat.release();

    expect(seat.status).toBe(SeatStatus.AVAILABLE);
    expect(seat.heldById).toBeNull();
    expect(seat.holdExpiresAt).toBeNull();
  });
});

describe("Seat.book", () => {
  it("books a currently held seat and clears hold state", () => {
    const seat = makeSeat({
      status: SeatStatus.HELD,
      heldById: 1,
      holdExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    seat.book();

    expect(seat.status).toBe(SeatStatus.BOOKED);
    expect(seat.heldById).toBeNull();
    expect(seat.holdExpiresAt).toBeNull();
  });

  it("rejects booking a seat that is not currently held", () => {
    const seat = makeSeat({ status: SeatStatus.AVAILABLE });
    expect(() => seat.book()).toThrow(SeatUnavailableError);
  });
});
