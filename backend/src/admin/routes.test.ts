import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Role, Show } from "@prisma/client";
import { createApp } from "../app";
import { FakeEmailSender } from "../auth/FakeEmailSender";
import { issueTokenPair } from "../auth/tokens";
import { cleanupShow, cleanupUsers, createTestSeat, createTestShow, createTestUser } from "../seats/testHelpers";
import { createConfirmedBooking } from "../bookings/testHelpers";

describe("admin routes", () => {
  const app = createApp({ emailSender: new FakeEmailSender() });
  let show: Show | undefined;
  let userIds: number[] = [];

  afterEach(async () => {
    if (show) await cleanupShow(show.id);
    show = undefined;
    await cleanupUsers(userIds);
    userIds = [];
  });

  describe("GET /admin/stats", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get("/admin/stats");
      expect(res.status).toBe(401);
    });

    it("rejects a non-admin user", async () => {
      const user = await createTestUser();
      userIds = [user.id];
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app).get("/admin/stats").set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(403);
    });

    it("returns totals including confirmed-booking revenue", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const [admin, buyer] = await Promise.all([createTestUser(Role.ADMIN), createTestUser()]);
      userIds = [admin.id, buyer.id];
      await createConfirmedBooking({ showId, userId: buyer.id, seatIds: [seat.id], totalPrice: 250 });
      const { accessToken } = await issueTokenPair(admin.id, admin.role);

      const res = await request(app).get("/admin/stats").set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.confirmedBookings).toBeGreaterThanOrEqual(1);
      expect(res.body.totalRevenue).toBeGreaterThanOrEqual(250);
    });
  });

  describe("GET /admin/shows", () => {
    it("includes seat and revenue stats for each show", async () => {
      show = await createTestShow();
      const showId = show.id;
      const bookedSeat = await createTestSeat(showId, { seatNumber: 1 });
      await createTestSeat(showId, { seatNumber: 2 });
      const [admin, buyer] = await Promise.all([createTestUser(Role.ADMIN), createTestUser()]);
      userIds = [admin.id, buyer.id];
      await createConfirmedBooking({ showId, userId: buyer.id, seatIds: [bookedSeat.id], totalPrice: 250 });
      const { accessToken } = await issueTokenPair(admin.id, admin.role);

      const res = await request(app).get("/admin/shows").set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const found = res.body.shows.find((s: { id: number }) => s.id === showId);
      expect(found).toMatchObject({ totalSeats: 2, bookedSeats: 1, availableSeats: 1, revenue: 250 });
    });
  });

  describe("GET /admin/bookings", () => {
    it("returns bookings across all users, not just the caller's", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const [admin, buyer] = await Promise.all([createTestUser(Role.ADMIN), createTestUser()]);
      userIds = [admin.id, buyer.id];
      await createConfirmedBooking({ showId, userId: buyer.id, seatIds: [seat.id] });
      const { accessToken } = await issueTokenPair(admin.id, admin.role);

      const res = await request(app).get("/admin/bookings").set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const found = res.body.bookings.find((b: { user: { id: number } }) => b.user.id === buyer.id);
      expect(found).toBeDefined();
      expect(found.show.id).toBe(showId);
    });

    it("filters by status when given", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const [admin, buyer] = await Promise.all([createTestUser(Role.ADMIN), createTestUser()]);
      userIds = [admin.id, buyer.id];
      await createConfirmedBooking({ showId, userId: buyer.id, seatIds: [seat.id] });
      const { accessToken } = await issueTokenPair(admin.id, admin.role);

      const res = await request(app)
        .get("/admin/bookings")
        .query({ status: "CANCELLED" })
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.bookings.find((b: { user: { id: number } }) => b.user.id === buyer.id)).toBeUndefined();
    });
  });
});
