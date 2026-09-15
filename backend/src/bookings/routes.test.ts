import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { BookingStatus, SeatStatus, Show } from "@prisma/client";
import { createApp } from "../app";
import { FakeEmailSender } from "../auth/FakeEmailSender";
import { issueTokenPair } from "../auth/tokens";
import { prisma } from "../db/prisma";
import { cleanupShow, cleanupUsers, createTestSeat, createTestShow, createTestUser } from "../seats/testHelpers";
import { createConfirmedBooking } from "./testHelpers";

describe("bookings routes", () => {
  const app = createApp({ emailSender: new FakeEmailSender() });
  let show: Show | undefined;
  let userIds: number[] = [];

  afterEach(async () => {
    if (show) await cleanupShow(show.id);
    show = undefined;
    await cleanupUsers(userIds);
    userIds = [];
  });

  describe("GET /bookings", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get("/bookings");
      expect(res.status).toBe(401);
    });

    it("returns only the requesting user's bookings", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seatMine = await createTestSeat(showId, { seatNumber: 1 });
      const seatTheirs = await createTestSeat(showId, { seatNumber: 2 });
      const [me, someoneElse] = await Promise.all([createTestUser(), createTestUser()]);
      userIds = [me.id, someoneElse.id];
      await createConfirmedBooking({ showId, userId: me.id, seatIds: [seatMine.id] });
      await createConfirmedBooking({ showId, userId: someoneElse.id, seatIds: [seatTheirs.id] });
      const { accessToken } = await issueTokenPair(me.id, me.role);

      const res = await request(app).get("/bookings").set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.bookings).toHaveLength(1);
      expect(res.body.bookings[0].seats[0].id).toBe(seatMine.id);
    });
  });

  describe("GET /bookings/:id/qr", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get("/bookings/1/qr");
      expect(res.status).toBe(401);
    });

    it("returns a PNG QR code for the owner's confirmed booking", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds = [user.id];
      const booking = await createConfirmedBooking({ showId, userId: user.id, seatIds: [seat.id] });
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app).get(`/bookings/${booking.id}/qr`).set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      // PNG file signature -- confirms this is a real image, not an empty
      // or malformed buffer slipping past the content-type header.
      expect(res.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });

    it("returns 404 for someone else's booking", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const [owner, attacker] = await Promise.all([createTestUser(), createTestUser()]);
      userIds = [owner.id, attacker.id];
      const booking = await createConfirmedBooking({ showId, userId: owner.id, seatIds: [seat.id] });
      const { accessToken } = await issueTokenPair(attacker.id, attacker.role);

      const res = await request(app).get(`/bookings/${booking.id}/qr`).set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
    });

    it("returns 409 for a booking that isn't confirmed yet", async () => {
      show = await createTestShow();
      const showId = show.id;
      const user = await createTestUser();
      userIds = [user.id];
      const pendingBooking = await prisma.booking.create({
        data: { userId: user.id, showId, status: BookingStatus.PENDING, totalPrice: 100 },
      });
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app)
        .get(`/bookings/${pendingBooking.id}/qr`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("BOOKING_NOT_CONFIRMED");

      await prisma.booking.delete({ where: { id: pendingBooking.id } });
    });

    it("returns 404 for a non-existent booking", async () => {
      const user = await createTestUser();
      userIds = [user.id];
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app).get("/bookings/999999999/qr").set("Authorization", `Bearer ${accessToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /bookings/:id/cancel", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).post("/bookings/1/cancel");
      expect(res.status).toBe(401);
    });

    it("cancels the user's own booking and frees the seat", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds = [user.id];
      const booking = await createConfirmedBooking({ showId, userId: user.id, seatIds: [seat.id] });
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app)
        .post(`/bookings/${booking.id}/cancel`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.booking.status).toBe("CANCELLED");

      const dbSeat = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(dbSeat?.status).toBe(SeatStatus.AVAILABLE);
    });

    it("returns 404 when cancelling someone else's booking", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const [owner, attacker] = await Promise.all([createTestUser(), createTestUser()]);
      userIds = [owner.id, attacker.id];
      const booking = await createConfirmedBooking({ showId, userId: owner.id, seatIds: [seat.id] });
      const { accessToken } = await issueTokenPair(attacker.id, attacker.role);

      const res = await request(app)
        .post(`/bookings/${booking.id}/cancel`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
    });

    it("returns 409 when cancelling within 1 hour of showtime", async () => {
      show = await createTestShow(new Date(Date.now() + 30 * 60 * 1000));
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds = [user.id];
      const booking = await createConfirmedBooking({ showId, userId: user.id, seatIds: [seat.id] });
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app)
        .post(`/bookings/${booking.id}/cancel`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CANCELLATION_NOT_ALLOWED");
    });
  });
});
