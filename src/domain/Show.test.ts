import { describe, expect, it } from "vitest";
import { SeatStatus } from "@prisma/client";
import { Show } from "./Show";
import { Seat } from "./Seat";

const NOW = new Date("2026-01-01T12:00:00Z");

function makeSeat(id: number, status: SeatStatus, holdExpiresAt: Date | null = null): Seat {
  return new Seat({
    id,
    showId: 1,
    status,
    heldById: status === SeatStatus.HELD ? 99 : null,
    holdExpiresAt,
    price: 250,
  });
}

describe("Show", () => {
  const seats = [
    makeSeat(1, SeatStatus.AVAILABLE),
    makeSeat(2, SeatStatus.BOOKED),
    makeSeat(3, SeatStatus.HELD, new Date(NOW.getTime() + 60_000)), // still validly held
    makeSeat(4, SeatStatus.HELD, new Date(NOW.getTime() - 60_000)), // expired hold
  ];
  const show = new Show(
    { id: 1, movieName: "Test Movie", venue: "Test Venue", showtime: new Date("2026-01-01T20:00:00Z") },
    seats
  );

  it("getSeats returns all seats", () => {
    expect(show.getSeats()).toHaveLength(4);
  });

  it("getSeat finds a seat by id", () => {
    expect(show.getSeat(2)?.status).toBe(SeatStatus.BOOKED);
  });

  it("getSeat returns undefined for an unknown id", () => {
    expect(show.getSeat(999)).toBeUndefined();
  });

  it("availableSeatCount counts AVAILABLE seats and seats with expired holds, not booked or validly-held ones", () => {
    // seat 1 (available) + seat 4 (expired hold) = 2
    expect(show.availableSeatCount(NOW)).toBe(2);
  });
});
