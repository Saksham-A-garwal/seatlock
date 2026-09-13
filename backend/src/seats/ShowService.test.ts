import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../db/prisma";
import { InvalidShowInputError } from "./errors";
import { ShowService } from "./ShowService";

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

function baseInput(overrides: Partial<Parameters<ShowService["createShow"]>[0]> = {}) {
  return {
    movieName: "Test Movie",
    venue: "Test Venue",
    showtime: FUTURE,
    rows: 3,
    columns: 4,
    basePrice: 250,
    ...overrides,
  };
}

describe("ShowService.createShow", () => {
  const showService = new ShowService();
  let showId: number | undefined;

  afterEach(async () => {
    if (showId) {
      await prisma.seat.deleteMany({ where: { showId } });
      await prisma.show.delete({ where: { id: showId } });
      showId = undefined;
    }
  });

  it("creates exactly rows x columns seats with no duplicate (rowLabel, seatNumber) pairs", async () => {
    const { show, seatsCreated } = await showService.createShow(baseInput({ rows: 3, columns: 4 }));
    showId = show.id;

    expect(seatsCreated).toBe(12);

    const seats = await prisma.seat.findMany({ where: { showId: show.id } });
    expect(seats).toHaveLength(12);

    const keys = new Set(seats.map((s) => `${s.rowLabel}${s.seatNumber}`));
    expect(keys.size).toBe(12); // no duplicates
  });

  // SRS edge case: "An admin creates a show with a duplicate seat layout
  // key (e.g., row A seat 1 twice)." The rows x columns generation model
  // means no ADMIN input path can actually produce this (there's no way to
  // specify individual seat keys) -- the test above already proves the
  // generator itself never does it. This test proves the deeper guarantee:
  // even bypassing the generator entirely, the database's own unique
  // constraint on (showId, rowLabel, seatNumber) refuses a duplicate,
  // so the invariant holds regardless of what future code calls this table.
  it("rejects a duplicate (showId, rowLabel, seatNumber) at the database level", async () => {
    const { show } = await showService.createShow(baseInput({ rows: 1, columns: 1 }));
    showId = show.id;

    await expect(
      prisma.seat.create({
        data: { showId: show.id, rowLabel: "A", seatNumber: 1, price: 100 },
      })
    ).rejects.toThrow();
  });

  it("labels rows with letters starting at A", async () => {
    const { show } = await showService.createShow(baseInput({ rows: 2, columns: 1 }));
    showId = show.id;

    const seats = await prisma.seat.findMany({ where: { showId: show.id }, orderBy: { rowLabel: "asc" } });
    expect(seats.map((s) => s.rowLabel)).toEqual(["A", "B"]);
  });

  it("applies basePrice uniformly to every generated seat", async () => {
    const { show } = await showService.createShow(baseInput({ rows: 2, columns: 2, basePrice: 375 }));
    showId = show.id;

    const seats = await prisma.seat.findMany({ where: { showId: show.id } });
    for (const seat of seats) {
      expect(seat.price.toNumber()).toBe(375);
    }
  });

  it("rejects a showtime in the past", async () => {
    const past = new Date(Date.now() - 60_000);
    await expect(showService.createShow(baseInput({ showtime: past }))).rejects.toThrow(InvalidShowInputError);
  });

  it("rejects an empty movieName", async () => {
    await expect(showService.createShow(baseInput({ movieName: "  " }))).rejects.toThrow(InvalidShowInputError);
  });

  it("rejects rows outside 1-26", async () => {
    await expect(showService.createShow(baseInput({ rows: 27 }))).rejects.toThrow(InvalidShowInputError);
    await expect(showService.createShow(baseInput({ rows: 0 }))).rejects.toThrow(InvalidShowInputError);
  });

  it("rejects columns outside 1-50", async () => {
    await expect(showService.createShow(baseInput({ columns: 51 }))).rejects.toThrow(InvalidShowInputError);
    await expect(showService.createShow(baseInput({ columns: 0 }))).rejects.toThrow(InvalidShowInputError);
  });

  it("rejects a non-positive basePrice", async () => {
    await expect(showService.createShow(baseInput({ basePrice: 0 }))).rejects.toThrow(InvalidShowInputError);
    await expect(showService.createShow(baseInput({ basePrice: -5 }))).rejects.toThrow(InvalidShowInputError);
  });
});
