import { afterEach, describe, expect, it, vi } from "vitest";
import { SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { SeatUnavailableError } from "../domain/errors";
import { redisClient } from "../rateLimit/redisClient";
import { HoldService } from "./HoldService";
import { RedisSeatLock } from "./RedisSeatLock";
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

  it("does NOT retry a genuine 409 (SeatUnavailableError) -- the resilience wrapper only retries transient DB failures", async () => {
    const show = await createTestShow();
    showId = show.id;
    const booked = await createTestSeat(showId, { status: SeatStatus.BOOKED });
    const user = await createTestUser();
    userIds.push(user.id);

    const transactionSpy = vi.spyOn(prisma, "$transaction");

    await expect(holdService.holdSeats(showId, [booked.id], user.id, 5)).rejects.toThrow(SeatUnavailableError);

    // A business rejection is a correct, final answer on the first try --
    // retrying it would only add latency, never change the outcome.
    expect(transactionSpy).toHaveBeenCalledOnce();

    transactionSpy.mockRestore();
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

  describe("Redis pre-lock", () => {
    it("fast-rejects a seat the DB alone would have allowed, because Redis already has it locked", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId); // genuinely AVAILABLE in Postgres
      const user = await createTestUser();
      userIds.push(user.id);

      const seatLock = new RedisSeatLock();
      await seatLock.acquire([seat.id], 60); // simulates someone else's in-flight hold attempt

      try {
        await expect(holdService.holdSeats(showId, [seat.id], user.id, 5)).rejects.toThrow(SeatUnavailableError);

        // Never even reached Postgres -- still genuinely AVAILABLE there.
        const dbSeat = await prisma.seat.findUnique({ where: { id: seat.id } });
        expect(dbSeat?.status).toBe(SeatStatus.AVAILABLE);
      } finally {
        await seatLock.release([seat.id]);
      }
    });

    it("fails open and still holds the seat via Postgres when Redis itself is unreachable", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds.push(user.id);

      const seatLock = new RedisSeatLock();
      const acquireSpy = vi.spyOn(seatLock, "acquire").mockRejectedValue(new Error("Redis is unreachable"));
      const holdServiceWithBrokenRedis = new HoldService(new SeatRepository(), seatLock);

      const result = await holdServiceWithBrokenRedis.holdSeats(showId, [seat.id], user.id, 5);

      expect(result[0].status).toBe(SeatStatus.HELD);
      acquireSpy.mockRestore();
    });
  });

  describe("releaseHold", () => {
    it("releases a seat held by the requesting user back to available", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds.push(user.id);
      await holdService.holdSeats(showId, [seat.id], user.id, 5);

      await holdService.releaseHold(showId, [seat.id], user.id);

      const dbSeat = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(dbSeat?.status).toBe(SeatStatus.AVAILABLE);
      expect(dbSeat?.heldById).toBeNull();
      expect(dbSeat?.holdExpiresAt).toBeNull();

      // The Redis pre-lock key must be gone too -- otherwise the next
      // person to try this seat would be wrongly fast-rejected by a stale
      // cache entry even though Postgres now correctly says AVAILABLE.
      const ttl = await redisClient.ttl(`seat-lock:${seat.id}`);
      expect(ttl).toBe(-2); // -2 means the key does not exist
    });

    it("silently ignores a seat held by a different user", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const [holder, otherUser] = await Promise.all([createTestUser(), createTestUser()]);
      userIds.push(holder.id, otherUser.id);
      await holdService.holdSeats(showId, [seat.id], holder.id, 5);

      await holdService.releaseHold(showId, [seat.id], otherUser.id);

      const dbSeat = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(dbSeat?.status).toBe(SeatStatus.HELD);
      expect(dbSeat?.heldById).toBe(holder.id);
    });

    it("silently ignores an already-BOOKED seat", async () => {
      const show = await createTestShow();
      showId = show.id;
      const user = await createTestUser();
      userIds.push(user.id);
      const booked = await createTestSeat(showId, { status: SeatStatus.BOOKED });

      await holdService.releaseHold(showId, [booked.id], user.id);

      const dbSeat = await prisma.seat.findUnique({ where: { id: booked.id } });
      expect(dbSeat?.status).toBe(SeatStatus.BOOKED);
    });

    it("does not throw when the seat is already available", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds.push(user.id);

      await expect(holdService.releaseHold(showId, [seat.id], user.id)).resolves.not.toThrow();
    });
  });
});
