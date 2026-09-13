import Stripe from "stripe";
import { BookingStatus, PaymentStatus, SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { Payment } from "../domain/Payment";
import { SeatRepository } from "../seats/SeatRepository";
import { SeatNotFoundError } from "../seats/errors";
import { HoldNotValidError } from "./errors";
import { stripeClient } from "./stripeClient";

function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

export class PaymentService {
  constructor(
    private readonly seatRepository: SeatRepository,
    private readonly stripe: Stripe = stripeClient
  ) {}

  // Plain (non-locking) read: this step calls out to Stripe, and a Postgres
  // row lock must never be held open across an external network call. This
  // is a best-effort UX check, not the authoritative one -- that happens in
  // confirmPayment, locked, once the webhook actually arrives.
  async createPaymentIntent(
    showId: number,
    seatIds: number[],
    userId: number
  ): Promise<{ clientSecret: string; paymentId: number }> {
    const uniqueSeatIds = [...new Set(seatIds)];
    const seats = await this.seatRepository.findByShow(showId);
    const seatsById = new Map(seats.map((seat) => [seat.id, seat]));

    const requestedSeats = uniqueSeatIds.map((id) => seatsById.get(id));
    if (requestedSeats.some((seat) => seat === undefined)) {
      throw new SeatNotFoundError();
    }

    const now = new Date();
    const validlyHeldByThisUser = requestedSeats.every(
      (seat) =>
        seat!.status === SeatStatus.HELD &&
        seat!.heldById === userId &&
        seat!.holdExpiresAt !== null &&
        seat!.holdExpiresAt.getTime() > now.getTime()
    );
    if (!validlyHeldByThisUser) {
      throw new HoldNotValidError();
    }

    const amount = requestedSeats.reduce((sum, seat) => sum + seat!.price, 0);

    const intent = await this.stripe.paymentIntents.create({
      amount: dollarsToCents(amount),
      currency: "usd",
      payment_method_types: ["card"],
      metadata: { userId: String(userId), showId: String(showId), seatIds: uniqueSeatIds.join(",") },
    });

    const payment = await prisma.payment.create({
      data: {
        userId,
        showId,
        seatIds: uniqueSeatIds,
        stripePaymentIntentId: intent.id,
        amount,
        status: PaymentStatus.PENDING,
      },
    });

    return { clientSecret: intent.client_secret as string, paymentId: payment.id };
  }

  // Called once a verified `payment_intent.succeeded` webhook event arrives.
  async confirmPayment(stripePaymentIntentId: string): Promise<void> {
    const paymentRow = await prisma.payment.findUnique({ where: { stripePaymentIntentId } });
    if (!paymentRow) {
      console.error(`Webhook confirmed an unknown payment intent: ${stripePaymentIntentId}`);
      return;
    }
    if (paymentRow.status !== PaymentStatus.PENDING) {
      // Already resolved -- a duplicate/out-of-order webhook beyond the event-id check.
      return;
    }

    const needsRefund = await prisma.$transaction(async (tx) => {
      // Re-lock the same seats, same pattern as Milestone 3's hold logic.
      const seats = await this.seatRepository.lockForUpdate(tx, paymentRow.showId, paymentRow.seatIds);
      const now = new Date();
      const holdSurvived =
        seats.length === paymentRow.seatIds.length &&
        seats.every(
          (seat) =>
            seat.status === SeatStatus.HELD &&
            seat.heldById === paymentRow.userId &&
            seat.holdExpiresAt !== null &&
            seat.holdExpiresAt.getTime() >= now.getTime()
        );

      const payment = new Payment({ ...paymentRow, amount: paymentRow.amount.toNumber() });

      if (!holdSurvived) {
        // The race case (SRS edge cases): payment succeeded, but the hold
        // didn't survive. Decision: refund-and-notify, not a grace period
        // -- see design notes. The actual Stripe refund call happens after
        // this transaction commits, never inside it.
        payment.markFailed();
        await tx.payment.update({ where: { id: paymentRow.id }, data: { status: payment.status } });
        return true;
      }

      const booking = await tx.booking.create({
        data: {
          userId: paymentRow.userId,
          showId: paymentRow.showId,
          status: BookingStatus.CONFIRMED,
          totalPrice: paymentRow.amount,
          confirmedAt: now,
          bookingSeats: { create: paymentRow.seatIds.map((seatId) => ({ seatId })) },
        },
      });

      await tx.seat.updateMany({
        where: { id: { in: paymentRow.seatIds } },
        data: { status: SeatStatus.BOOKED, heldById: null, holdExpiresAt: null },
      });

      payment.markSucceeded(booking.id);
      await tx.payment.update({
        where: { id: paymentRow.id },
        data: { status: payment.status, bookingId: payment.bookingId },
      });

      return false;
    });

    if (needsRefund) {
      await this.stripe.refunds.create({ payment_intent: stripePaymentIntentId });
      console.error(
        `Refunded payment ${stripePaymentIntentId}: hold expired before webhook confirmation arrived (race case, see SRS edge cases).`
      );
    }
  }

  // Called on a verified `payment_intent.payment_failed` webhook event.
  async markPaymentFailed(stripePaymentIntentId: string): Promise<void> {
    const paymentRow = await prisma.payment.findUnique({ where: { stripePaymentIntentId } });
    if (!paymentRow || paymentRow.status !== PaymentStatus.PENDING) {
      return;
    }

    // Per SRS section 7 + the UI/UX doc: the hold is left exactly as-is so
    // the user can retry within the remaining hold time without losing
    // their seat selection -- only the Payment row itself changes.
    const payment = new Payment({ ...paymentRow, amount: paymentRow.amount.toNumber() });
    payment.markFailed();
    await prisma.payment.update({ where: { id: paymentRow.id }, data: { status: payment.status } });
  }
}
