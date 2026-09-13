import { afterEach, describe, expect, it } from "vitest";
import { BookingStatus, PaymentStatus, SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { SeatRepository } from "../seats/SeatRepository";
import { SeatNotFoundError } from "../seats/errors";
import { cleanupShow, cleanupUsers, createTestSeat, createTestShow, createTestUser } from "../seats/testHelpers";
import { HoldNotValidError } from "./errors";
import { PaymentService } from "./PaymentService";
import { stripeClient } from "./stripeClient";

describe("PaymentService", () => {
  const paymentService = new PaymentService(new SeatRepository());
  let showId: number | undefined;
  const userIds: number[] = [];
  const paymentIds: number[] = [];

  afterEach(async () => {
    if (paymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      paymentIds.length = 0;
    }
    if (showId) await cleanupShow(showId);
    showId = undefined;
    await cleanupUsers(userIds);
    userIds.length = 0;
  });

  describe("createPaymentIntent", () => {
    it("creates a real Stripe PaymentIntent for a validly held seat", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId, { price: 500 });
      const user = await createTestUser();
      userIds.push(user.id);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      const result = await paymentService.createPaymentIntent(showId, [seat.id], user.id);
      paymentIds.push(result.paymentId);

      expect(result.clientSecret).toMatch(/^pi_/);

      const payment = await prisma.payment.findUnique({ where: { id: result.paymentId } });
      expect(payment?.status).toBe(PaymentStatus.PENDING);
      expect(payment?.amount.toNumber()).toBe(500);

      const intent = await stripeClient.paymentIntents.retrieve(payment!.stripePaymentIntentId);
      expect(intent.amount).toBe(50_000);
    });

    it("rejects a seat that was never held", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds.push(user.id);

      await expect(paymentService.createPaymentIntent(showId, [seat.id], user.id)).rejects.toThrow(
        HoldNotValidError
      );
    });

    it("rejects a seat held by a different user", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const [holder, otherUser] = await Promise.all([createTestUser(), createTestUser()]);
      userIds.push(holder.id, otherUser.id);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: holder.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      await expect(paymentService.createPaymentIntent(showId, [seat.id], otherUser.id)).rejects.toThrow(
        HoldNotValidError
      );
    });

    it("rejects a seat whose hold has expired", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds.push(user.id);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() - 1000) },
      });

      await expect(paymentService.createPaymentIntent(showId, [seat.id], user.id)).rejects.toThrow(
        HoldNotValidError
      );
    });

    it("rejects a seat that doesn't belong to the given show", async () => {
      const show = await createTestShow();
      showId = show.id;
      const otherShow = await createTestShow();
      const seat = await createTestSeat(otherShow.id);
      const user = await createTestUser();
      userIds.push(user.id);

      await expect(paymentService.createPaymentIntent(showId, [seat.id], user.id)).rejects.toThrow(
        SeatNotFoundError
      );

      await cleanupShow(otherShow.id);
    });
  });

  describe("confirmPayment", () => {
    it("books the seat when the hold survived until the webhook arrives", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId, { price: 300 });
      const user = await createTestUser();
      userIds.push(user.id);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      const { paymentId } = await paymentService.createPaymentIntent(showId, [seat.id], user.id);
      paymentIds.push(paymentId);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      await paymentService.confirmPayment(payment.stripePaymentIntentId);

      const updatedPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
      expect(updatedPayment?.status).toBe(PaymentStatus.SUCCEEDED);
      expect(updatedPayment?.bookingId).not.toBeNull();

      const bookedSeat = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(bookedSeat?.status).toBe(SeatStatus.BOOKED);

      const booking = await prisma.booking.findUnique({ where: { id: updatedPayment!.bookingId! } });
      expect(booking?.status).toBe(BookingStatus.CONFIRMED);
      expect(booking?.totalPrice.toNumber()).toBe(300);
    });

    it("is idempotent: calling it twice for the same intent only books once", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds.push(user.id);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      const { paymentId } = await paymentService.createPaymentIntent(showId, [seat.id], user.id);
      paymentIds.push(paymentId);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      await paymentService.confirmPayment(payment.stripePaymentIntentId);
      await paymentService.confirmPayment(payment.stripePaymentIntentId);

      const bookingCount = await prisma.booking.count({ where: { showId, userId: user.id } });
      expect(bookingCount).toBe(1);
    });

    it(
      "refunds and marks FAILED when the hold expired before the webhook arrived (the race case)",
      async () => {
        const show = await createTestShow();
        showId = show.id;
        const seat = await createTestSeat(showId, { price: 400 });
        const user = await createTestUser();
        userIds.push(user.id);
        await prisma.seat.update({
          where: { id: seat.id },
          data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
        });

        const { paymentId } = await paymentService.createPaymentIntent(showId, [seat.id], user.id);
        paymentIds.push(paymentId);
        const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

        // Actually complete the payment on Stripe's side (test card token)
        // so the refund call below is a real Stripe operation, not a no-op.
        await stripeClient.paymentIntents.confirm(payment.stripePaymentIntentId, {
          payment_method: "pm_card_visa",
        });

        // Simulate the hold having expired in the meantime.
        await prisma.seat.update({ where: { id: seat.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

        await paymentService.confirmPayment(payment.stripePaymentIntentId);

        const updatedPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
        expect(updatedPayment?.status).toBe(PaymentStatus.FAILED);
        expect(updatedPayment?.bookingId).toBeNull();

        const seatAfter = await prisma.seat.findUnique({ where: { id: seat.id } });
        expect(seatAfter?.status).toBe(SeatStatus.HELD); // untouched; sweep/FR-5 handles reclaiming it

        const refunds = await stripeClient.refunds.list({ payment_intent: payment.stripePaymentIntentId });
        expect(refunds.data.length).toBeGreaterThanOrEqual(1);
      },
      15_000
    );
  });

  describe("markPaymentFailed", () => {
    it("marks the payment FAILED and leaves the hold intact for retry", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds.push(user.id);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      const { paymentId } = await paymentService.createPaymentIntent(showId, [seat.id], user.id);
      paymentIds.push(paymentId);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      await paymentService.markPaymentFailed(payment.stripePaymentIntentId);

      const updatedPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
      expect(updatedPayment?.status).toBe(PaymentStatus.FAILED);

      const seatAfter = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(seatAfter?.status).toBe(SeatStatus.HELD);
      expect(seatAfter?.heldById).toBe(user.id);
    });
  });
});
