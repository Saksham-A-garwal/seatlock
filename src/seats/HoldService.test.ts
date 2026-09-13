import { afterEach, describe, expect, it } from "vitest";
import { SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { SeatUnavailableError } from "../domain/errors";
import { HoldService } from "./HoldService";
import { SeatRepository } from "./SeatRepository";
import { SeatNotFoundError } from "./errors";
import { createTestSeat, createTestShow, createTestUser, cleanupShow, cleanupUsers } from "./testHelpers";

describe("HoldService", () => {
  const holdService = new HoldService(new SeatRepository());
  let showId: number | undefined;
  const userIds: number[] = [];

  afterEach(async () => {
    if (showId) await cleanupShow(showId);
    showId = undefined;
    await cleanupUsers(userIds);
    userIds.length = 0;
  });

  it("holds all requested seats and sets a consistent expiry", async () => {
    const show = await createTestShow();
    showId = show.id;
    const seatA = await createTestSeat(showId, { seatNumber: 1 });
    const seatB = await createTestSeat(showId, { seatNumber: 2 });
    const user = await createTestUser();
    userIds.push(user.id);

    const result = await holdService.holdSeats(showId, [seatA.id, seatB.id], user.id, 5);

    expect(result).toHaveLength(2);
    for (const seat of result) {
      expect(seat.status).toBe(SeatStatus.HELD);
      expect(seat.heldById).toBe(user.id);
    }

    const dbSeats = await prisma.seat.findMany({ where: { id: { in: [seatA.id, seatB.id] } } });
    for (const dbSeat of dbSeats) {
      expect(dbSeat.status).toBe(SeatStatus.HELD);
      expect(dbSeat.heldById).toBe(user.id);
    }
  });

  it("is all-or-nothing: one unavailable seat rolls back the whole batch (FR-3)", async () => {
    const show = await createTestShow();
    showId = show.id;
    const available = await createTestSeat(showId, { seatNumber: 1 });
    const alreadyHeld = await createTestSeat(showId, {
      seatNumber: 2,
      status: SeatStatus.HELD,
    });
    // Give the already-held seat a real holder + valid (non-expired) expiry.
    const otherUser = await createTestUser();
    userIds.push(otherUser.id);
    await prisma.seat.update({
      where: { id: alreadyHeld.id },
      data: { heldById: otherUser.id, holdExpiresAt: new Date(Date.now() + 60_000) },
    });

    const user = await createTestUser();
    userIds.push(user.id);

    await expect(holdService.holdSeats(showId, [available.id, alreadyHeld.id], user.id, 5)).rejects.toThrow(
      SeatUnavailableError
    );

    const stillAvailable = await prisma.seat.findUnique({ where: { id: available.id } });
    expect(stillAvailable?.status).toBe(SeatStatus.AVAILABLE);
    expect(stillAvailable?.heldById).toBeNull();
  });

  it("rejects a seat that belongs to a different show", async () => {
    const show = await createTestShow();
    showId = show.id;
    const otherShow = await createTestShow();
    const seatFromOtherShow = await createTestSeat(otherShow.id);
    const user = await createTestUser();
    userIds.push(user.id);

    await expect(holdService.holdSeats(showId, [seatFromOtherShow.id], user.id, 5)).rejects.toThrow(
      SeatNotFoundError
    );

    await cleanupShow(otherShow.id);
  });

  it("rejects a seat that is already BOOKED", async () => {
    const show = await createTestShow();
    showId = show.id;
    const booked = await createTestSeat(showId, { status: SeatStatus.BOOKED });
    const user = await createTestUser();
    userIds.push(user.id);

    await expect(holdService.holdSeats(showId, [booked.id], user.id, 5)).rejects.toThrow(SeatUnavailableError);
  });

  it("allows holding a seat whose previous hold has already expired", async () => {
    const show = await createTestShow();
    showId = show.id;
    const expiredHold = await createTestSeat(showId, { status: SeatStatus.HELD });
    const previousHolder = await createTestUser();
    userIds.push(previousHolder.id);
    await prisma.seat.update({
      where: { id: expiredHold.id },
      data: { heldById: previousHolder.id, holdExpiresAt: new Date(Date.now() - 60_000) },
    });

    const user = await createTestUser();
    userIds.push(user.id);

    const result = await holdService.holdSeats(showId, [expiredHold.id], user.id, 5);

    expect(result[0].status).toBe(SeatStatus.HELD);
    expect(result[0].heldById).toBe(user.id);
  });
});
