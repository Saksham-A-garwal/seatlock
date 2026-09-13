import { afterEach, describe, expect, it } from "vitest";
import { SeatStatus, Show } from "@prisma/client";
import { prisma } from "../db/prisma";
import { SeatRepository } from "./SeatRepository";
import { cleanupShow, cleanupUsers, createTestSeat, createTestShow, createTestUser } from "./testHelpers";

describe("SeatRepository", () => {
  const seatRepository = new SeatRepository();
  let show: Show | undefined;
  let userIds: number[] = [];

  afterEach(async () => {
    if (show) await cleanupShow(show.id);
    show = undefined;
    await cleanupUsers(userIds);
    userIds = [];
  });

  describe("sweepExpiredHolds", () => {
    it("resets an expired HELD seat back to AVAILABLE", async () => {
      show = await createTestShow();
      const seat = await createTestSeat(show.id, { status: SeatStatus.HELD });
      const holder = await createTestUser();
      userIds = [holder.id];
      await prisma.seat.update({
        where: { id: seat.id },
        data: { heldById: holder.id, holdExpiresAt: new Date(Date.now() - 1000) },
      });

      const count = await seatRepository.sweepExpiredHolds();

      const swept = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(count).toBeGreaterThanOrEqual(1);
      expect(swept?.status).toBe(SeatStatus.AVAILABLE);
      expect(swept?.heldById).toBeNull();
      expect(swept?.holdExpiresAt).toBeNull();
    });

    it("does not touch a seat whose hold is still valid", async () => {
      show = await createTestShow();
      const seat = await createTestSeat(show.id, { status: SeatStatus.HELD });
      const holder = await createTestUser();
      userIds = [holder.id];
      await prisma.seat.update({
        where: { id: seat.id },
        data: { heldById: holder.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      await seatRepository.sweepExpiredHolds();

      const untouched = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(untouched?.status).toBe(SeatStatus.HELD);
      expect(untouched?.heldById).toBe(holder.id);
    });

    it("does not touch a BOOKED seat", async () => {
      show = await createTestShow();
      const seat = await createTestSeat(show.id, { status: SeatStatus.BOOKED });

      await seatRepository.sweepExpiredHolds();

      const untouched = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(untouched?.status).toBe(SeatStatus.BOOKED);
    });
  });

  describe("lockForUpdate", () => {
    it("only returns seats belonging to the given show", async () => {
      show = await createTestShow();
      const showId = show.id;
      const otherShow = await createTestShow();
      const seatInShow = await createTestSeat(showId);
      const seatInOtherShow = await createTestSeat(otherShow.id);

      const result = await prisma.$transaction((tx) =>
        seatRepository.lockForUpdate(tx, showId, [seatInShow.id, seatInOtherShow.id])
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(seatInShow.id);

      await cleanupShow(otherShow.id);
    });

    it("returns seats ordered by id", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seatB = await createTestSeat(showId, { seatNumber: 2 });
      const seatA = await createTestSeat(showId, { seatNumber: 1 });

      const result = await prisma.$transaction((tx) => seatRepository.lockForUpdate(tx, showId, [seatB.id, seatA.id]));

      expect(result.map((s) => s.id)).toEqual([seatA.id, seatB.id].sort((a, b) => a - b));
    });
  });
});
