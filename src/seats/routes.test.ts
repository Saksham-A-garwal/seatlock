import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { SeatStatus, Show } from "@prisma/client";
import { createApp } from "../app";
import { FakeEmailSender } from "../auth/FakeEmailSender";
import { issueTokenPair } from "../auth/tokens";
import { config } from "../config";
import { prisma } from "../db/prisma";
import { cleanupShow, cleanupUsers, createTestSeat, createTestShow, createTestUser } from "./testHelpers";

describe("seats routes", () => {
  let show: Show | undefined;
  let userIds: number[] = [];
  const app = createApp({ emailSender: new FakeEmailSender() });

  afterEach(async () => {
    if (show) await cleanupShow(show.id);
    show = undefined;
    await cleanupUsers(userIds);
    userIds = [];
  });

  describe("GET /shows", () => {
    it("reports available-seat count that includes expired holds and excludes booked/valid-held seats", async () => {
      show = await createTestShow();
      const showId = show.id;
      await createTestSeat(showId, { seatNumber: 1, status: SeatStatus.AVAILABLE });
      await createTestSeat(showId, { seatNumber: 2, status: SeatStatus.BOOKED });
      const validHeld = await createTestSeat(showId, { seatNumber: 3, status: SeatStatus.HELD });
      const expiredHeld = await createTestSeat(showId, { seatNumber: 4, status: SeatStatus.HELD });
      const holder = await createTestUser();
      userIds = [holder.id];
      await prisma.seat.update({
        where: { id: validHeld.id },
        data: { heldById: holder.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });
      await prisma.seat.update({
        where: { id: expiredHeld.id },
        data: { heldById: holder.id, holdExpiresAt: new Date(Date.now() - 60_000) },
      });

      const res = await request(app).get("/shows");

      expect(res.status).toBe(200);
      const entry = res.body.shows.find((s: { id: number }) => s.id === showId);
      // seat 1 (available) + seat 4 (expired hold) = 2
      expect(entry.availableSeatCount).toBe(2);
    });
  });

  describe("GET /shows/:id/seats", () => {
    it("returns 404 for an unknown show", async () => {
      const res = await request(app).get("/shows/999999999/seats");
      expect(res.status).toBe(404);
    });

    it("returns 400 for a non-numeric show id", async () => {
      const res = await request(app).get("/shows/not-a-number/seats");
      expect(res.status).toBe(400);
    });

    it("reports an expired HELD seat as AVAILABLE (FR-5)", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId, { status: SeatStatus.HELD });
      const holder = await createTestUser();
      userIds = [holder.id];
      await prisma.seat.update({
        where: { id: seat.id },
        data: { heldById: holder.id, holdExpiresAt: new Date(Date.now() - 60_000) },
      });

      const res = await request(app).get(`/shows/${showId}/seats`);

      expect(res.status).toBe(200);
      expect(res.body.seats[0].status).toBe("AVAILABLE");
    });
  });

  describe("POST /shows/:id/hold", () => {
    it("rejects an unauthenticated request", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);

      const res = await request(app).post(`/shows/${showId}/hold`).send({ seatIds: [seat.id] });

      expect(res.status).toBe(401);
    });

    it("rejects an empty seatIds array", async () => {
      show = await createTestShow();
      const showId = show.id;
      const user = await createTestUser();
      userIds = [user.id];
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app)
        .post(`/shows/${showId}/hold`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ seatIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_SEAT_IDS");
    });

    it("holds a real available seat successfully", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds = [user.id];
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app)
        .post(`/shows/${showId}/hold`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ seatIds: [seat.id] });

      expect(res.status).toBe(200);
      expect(res.body.seats[0].status).toBe("HELD");
      expect(res.body.holdExpiresAt).toBeTruthy();
    });

    it(
      "rate-limits a single user past the configured per-minute hold limit",
      async () => {
        show = await createTestShow();
        const showId = show.id;
        const user = await createTestUser();
        userIds = [user.id];
        const { accessToken } = await issueTokenPair(user.id, user.role);
        const limit = config.rateLimits.holdPerUserPerMinute;

        const seats = await Promise.all(
          Array.from({ length: limit }, (_, i) => createTestSeat(showId, { seatNumber: i + 1 }))
        );

        // `limit` requests, each holding a distinct real seat -- all must succeed.
        for (const seat of seats) {
          const res = await request(app)
            .post(`/shows/${showId}/hold`)
            .set("Authorization", `Bearer ${accessToken}`)
            .send({ seatIds: [seat.id] });
          expect(res.status).toBe(200);
        }

        // The next request from the SAME user, within the same window, is over the limit.
        const extraSeat = await createTestSeat(showId, { seatNumber: limit + 1 });
        const blocked = await request(app)
          .post(`/shows/${showId}/hold`)
          .set("Authorization", `Bearer ${accessToken}`)
          .send({ seatIds: [extraSeat.id] });

        expect(blocked.status).toBe(429);
        expect(blocked.body.error.code).toBe("RATE_LIMITED");
      },
      20_000
    );
  });
});
