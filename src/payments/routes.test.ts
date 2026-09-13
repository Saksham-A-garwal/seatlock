import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { SeatStatus, Show } from "@prisma/client";
import { createApp } from "../app";
import { FakeEmailSender } from "../auth/FakeEmailSender";
import { issueTokenPair } from "../auth/tokens";
import { prisma } from "../db/prisma";
import { cleanupShow, cleanupUsers, createTestSeat, createTestShow, createTestUser } from "../seats/testHelpers";
import { buildSignedWebhookPayload, makeStripeEventBody } from "./testHelpers";

describe("payments routes", () => {
  const app = createApp({ emailSender: new FakeEmailSender() });
  let show: Show | undefined;
  let userIds: number[] = [];
  let paymentIds: number[] = [];

  afterEach(async () => {
    if (paymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      paymentIds = [];
    }
    if (show) await cleanupShow(show.id);
    show = undefined;
    await cleanupUsers(userIds);
    userIds = [];
  });

  describe("POST /payments/create-intent", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).post("/payments/create-intent").send({ showId: 1, seatIds: [1] });
      expect(res.status).toBe(401);
    });

    it("rejects an invalid body", async () => {
      const user = await createTestUser();
      userIds = [user.id];
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app)
        .post("/payments/create-intent")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ showId: 1, seatIds: [] });

      expect(res.status).toBe(400);
    });

    it("returns 410 for a seat that is not validly held by the requester", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds = [user.id];
      const { accessToken } = await issueTokenPair(user.id, user.role);

      const res = await request(app)
        .post("/payments/create-intent")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ showId, seatIds: [seat.id] });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("HOLD_NOT_VALID");
    });

    it("creates a real payment intent for a validly held seat", async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId, { price: 200 });
      const user = await createTestUser();
      userIds = [user.id];
      const { accessToken } = await issueTokenPair(user.id, user.role);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      const res = await request(app)
        .post("/payments/create-intent")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ showId, seatIds: [seat.id] });

      expect(res.status).toBe(200);
      expect(res.body.clientSecret).toMatch(/^pi_/);
      paymentIds.push(res.body.paymentId);
    });
  });

  describe("POST /payments/webhook", () => {
    it("rejects a request with a missing signature", async () => {
      const res = await request(app)
        .post("/payments/webhook")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ id: "evt_test", type: "payment_intent.succeeded" }));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("MISSING_SIGNATURE");
    });

    it("rejects a request with an invalid signature", async () => {
      const res = await request(app)
        .post("/payments/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", "t=1,v1=not-a-real-signature")
        .send(JSON.stringify({ id: "evt_test", type: "payment_intent.succeeded" }));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_SIGNATURE");
    });

    it(
      "confirms a booking on a validly signed payment_intent.succeeded event, and processing the SAME event twice does not double-book",
      async () => {
        show = await createTestShow();
        const showId = show.id;
        const seat = await createTestSeat(showId, { price: 150 });
        const user = await createTestUser();
        userIds = [user.id];
        const { accessToken } = await issueTokenPair(user.id, user.role);
        await prisma.seat.update({
          where: { id: seat.id },
          data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
        });

        const intentRes = await request(app)
          .post("/payments/create-intent")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({ showId, seatIds: [seat.id] });
        paymentIds.push(intentRes.body.paymentId);
        const payment = await prisma.payment.findUniqueOrThrow({ where: { id: intentRes.body.paymentId } });

        const eventBody = makeStripeEventBody(
          `evt_test_${Date.now()}`,
          "payment_intent.succeeded",
          payment.stripePaymentIntentId
        );
        const { payload, signature } = buildSignedWebhookPayload(eventBody);

        const firstRes = await request(app)
          .post("/payments/webhook")
          .set("Content-Type", "application/json")
          .set("Stripe-Signature", signature)
          .send(payload);
        expect(firstRes.status).toBe(200);

        const secondRes = await request(app)
          .post("/payments/webhook")
          .set("Content-Type", "application/json")
          .set("Stripe-Signature", signature)
          .send(payload);
        expect(secondRes.status).toBe(200);

        const bookingCount = await prisma.booking.count({ where: { showId, userId: user.id } });
        expect(bookingCount).toBe(1);

        const seatAfter = await prisma.seat.findUnique({ where: { id: seat.id } });
        expect(seatAfter?.status).toBe(SeatStatus.BOOKED);
      },
      15_000
    );

    it(
      "marks the payment FAILED on a validly signed payment_intent.payment_failed event, without touching the seat",
      async () => {
        show = await createTestShow();
        const showId = show.id;
        const seat = await createTestSeat(showId);
        const user = await createTestUser();
        userIds = [user.id];
        const { accessToken } = await issueTokenPair(user.id, user.role);
        await prisma.seat.update({
          where: { id: seat.id },
          data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
        });

        const intentRes = await request(app)
          .post("/payments/create-intent")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({ showId, seatIds: [seat.id] });
        paymentIds.push(intentRes.body.paymentId);
        const payment = await prisma.payment.findUniqueOrThrow({ where: { id: intentRes.body.paymentId } });

        const eventBody = makeStripeEventBody(
          `evt_test_${Date.now()}`,
          "payment_intent.payment_failed",
          payment.stripePaymentIntentId
        );
        const { payload, signature } = buildSignedWebhookPayload(eventBody);

        const res = await request(app)
          .post("/payments/webhook")
          .set("Content-Type", "application/json")
          .set("Stripe-Signature", signature)
          .send(payload);
        expect(res.status).toBe(200);

        const updatedPayment = await prisma.payment.findUnique({ where: { id: payment.id } });
        expect(updatedPayment?.status).toBe("FAILED");

        const seatAfter = await prisma.seat.findUnique({ where: { id: seat.id } });
        expect(seatAfter?.status).toBe(SeatStatus.HELD);
      },
      15_000
    );
  });
});
