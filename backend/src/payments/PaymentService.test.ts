import { afterEach, describe, expect, it, vi } from "vitest";
import type { Refunds } from "razorpay/dist/types/refunds";
import { BookingStatus, PaymentStatus, SeatStatus } from "@prisma/client";
import { FakeEmailSender } from "../auth/FakeEmailSender";
import { prisma } from "../db/prisma";
import { SeatRepository } from "../seats/SeatRepository";
import { SeatNotFoundError } from "../seats/errors";
import { cleanupShow, cleanupUsers, createTestSeat, createTestShow, createTestUser } from "../seats/testHelpers";
import { HoldNotValidError } from "./errors";
import { PaymentService } from "./PaymentService";
import { razorpayClient } from "./razorpayClient";

describe("PaymentService", () => {
  const emailSender = new FakeEmailSender();
  const paymentService = new PaymentService(new SeatRepository(), undefined, emailSender);
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
    emailSender.sent.length = 0;
  });

  describe("createOrder", () => {
    it("creates a real Razorpay order for a validly held seat", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId, { price: 500 });
      const user = await createTestUser();
      userIds.push(user.id);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      const result = await paymentService.createOrder(showId, [seat.id], user.id);
      paymentIds.push(result.paymentId);

      expect(result.orderId).toMatch(/^order_/);
      expect(result.currency).toBe("INR");

      const payment = await prisma.payment.findUnique({ where: { id: result.paymentId } });
      expect(payment?.status).toBe(PaymentStatus.PENDING);
      expect(payment?.amount.toNumber()).toBe(500);

      const order = await razorpayClient.orders.fetch(payment!.razorpayOrderId);
      expect(order.amount).toBe(50_000);
    });

    it("rejects a seat that was never held", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds.push(user.id);

      await expect(paymentService.createOrder(showId, [seat.id], user.id)).rejects.toThrow(HoldNotValidError);
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

      await expect(paymentService.createOrder(showId, [seat.id], otherUser.id)).rejects.toThrow(HoldNotValidError);
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

      await expect(paymentService.createOrder(showId, [seat.id], user.id)).rejects.toThrow(HoldNotValidError);
    });

    it("rejects a seat that doesn't belong to the given show", async () => {
      const show = await createTestShow();
      showId = show.id;
      const otherShow = await createTestShow();
      const seat = await createTestSeat(otherShow.id);
      const user = await createTestUser();
      userIds.push(user.id);

      await expect(paymentService.createOrder(showId, [seat.id], user.id)).rejects.toThrow(SeatNotFoundError);

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

      const { paymentId } = await paymentService.createOrder(showId, [seat.id], user.id);
      paymentIds.push(paymentId);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      await paymentService.confirmPayment(payment.razorpayOrderId, "pay_test_synthetic");

      const updatedPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
      expect(updatedPayment?.status).toBe(PaymentStatus.SUCCEEDED);
      expect(updatedPayment?.bookingId).not.toBeNull();
      expect(updatedPayment?.razorpayPaymentId).toBe("pay_test_synthetic");

      const bookedSeat = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(bookedSeat?.status).toBe(SeatStatus.BOOKED);

      const booking = await prisma.booking.findUnique({ where: { id: updatedPayment!.bookingId! } });
      expect(booking?.status).toBe(BookingStatus.CONFIRMED);
      expect(booking?.totalPrice.toNumber()).toBe(300);
    });

    it("sends a confirmation email with an inline QR ticket once the booking is confirmed", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId, { price: 300 });
      const user = await createTestUser();
      userIds.push(user.id);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      const { paymentId } = await paymentService.createOrder(showId, [seat.id], user.id);
      paymentIds.push(paymentId);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      await paymentService.confirmPayment(payment.razorpayOrderId, "pay_test_synthetic");

      const updatedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: updatedPayment.bookingId! } });

      expect(emailSender.sent).toHaveLength(1);
      const [message] = emailSender.sent;
      expect(message.to).toBe(user.email);
      expect(message.subject).toContain(show.movieName);
      expect(message.text).toContain(`${seat.rowLabel}${seat.seatNumber}`);
      expect(message.text).toContain(`SEATLOCK-BOOKING-${booking.id}`);
      expect(message.html).toContain("cid:booking-qr");
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments![0].contentId).toBe("booking-qr");
      expect(message.attachments![0].contentType).toBe("image/png");
      expect(message.attachments![0].content.length).toBeGreaterThan(0);
    });

    it("is idempotent: calling it twice for the same order only books once", async () => {
      const show = await createTestShow();
      showId = show.id;
      const seat = await createTestSeat(showId);
      const user = await createTestUser();
      userIds.push(user.id);
      await prisma.seat.update({
        where: { id: seat.id },
        data: { status: SeatStatus.HELD, heldById: user.id, holdExpiresAt: new Date(Date.now() + 60_000) },
      });

      const { paymentId } = await paymentService.createOrder(showId, [seat.id], user.id);
      paymentIds.push(paymentId);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      await paymentService.confirmPayment(payment.razorpayOrderId, "pay_test_synthetic");
      await paymentService.confirmPayment(payment.razorpayOrderId, "pay_test_synthetic");

      const bookingCount = await prisma.booking.count({ where: { showId, userId: user.id } });
      expect(bookingCount).toBe(1);
    });

    // Unlike Stripe (paymentIntents.confirm with a test card token), Razorpay
    // has no headless, server-side-only way to drive a test order to a real
    // `captured` payment -- test mode is exercised through Checkout.js (a
    // browser). So this test stubs only the actual refund round-trip; the
    // DB transaction, the hold-expiry detection, the FAILED status, and the
    // seat being left untouched are all real, same as every other case here.
    // The webhook's real signature verification is proven separately in
    // routes.test.ts.
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

        const { paymentId } = await paymentService.createOrder(showId, [seat.id], user.id);
        paymentIds.push(paymentId);
        const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

        const refundSpy = vi.spyOn(razorpayClient.payments, "refund");
        refundSpy.mockImplementation(
          (async () => ({ id: "rfnd_test", entity: "refund" }) as Refunds.RazorpayRefund) as typeof razorpayClient.payments.refund
        );

        // Simulate the hold having expired in the meantime.
        await prisma.seat.update({ where: { id: seat.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

        await paymentService.confirmPayment(payment.razorpayOrderId, "pay_test_synthetic");

        const updatedPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
        expect(updatedPayment?.status).toBe(PaymentStatus.FAILED);
        expect(updatedPayment?.bookingId).toBeNull();

        const seatAfter = await prisma.seat.findUnique({ where: { id: seat.id } });
        expect(seatAfter?.status).toBe(SeatStatus.HELD); // untouched; sweep/FR-5 handles reclaiming it

        expect(refundSpy).toHaveBeenCalledWith("pay_test_synthetic", { amount: 40_000 });
        refundSpy.mockRestore();

        // No booking was made, so there is nothing to confirm by email.
        expect(emailSender.sent).toHaveLength(0);
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

      const { paymentId } = await paymentService.createOrder(showId, [seat.id], user.id);
      paymentIds.push(paymentId);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

      await paymentService.markPaymentFailed(payment.razorpayOrderId, "pay_test_synthetic");

      const updatedPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
      expect(updatedPayment?.status).toBe(PaymentStatus.FAILED);

      const seatAfter = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(seatAfter?.status).toBe(SeatStatus.HELD);
      expect(seatAfter?.heldById).toBe(user.id);
    });
  });
});
