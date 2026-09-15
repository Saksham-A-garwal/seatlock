import Razorpay from "razorpay";
import { BookingStatus, PaymentStatus, SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { EmailSender } from "../auth/EmailSender";
import { ResendEmailSender } from "../auth/ResendEmailSender";
import { buildBookingConfirmationEmail } from "../bookings/BookingConfirmationEmail";
import { isRetryableDbError } from "../resilience/isRetryableDbError";
import { isRetryableRazorpayError } from "../resilience/isRetryableRazorpayError";
import { withRetry } from "../resilience/withRetry";
import { Payment } from "../domain/Payment";
import { SeatRepository } from "../seats/SeatRepository";
import { SeatNotFoundError } from "../seats/errors";
import { HoldNotValidError } from "./errors";
import { razorpayClient } from "./razorpayClient";

// What actually happened inside the transaction, decided and persisted in
// there; the confirmation email (and, on the other branch, the refund) is
// sent only after that transaction has committed -- same reasoning as
// rotateRefreshToken's RotationOutcome: never do external I/O, or decide
// what to do about it, from inside an interactive transaction.
type ConfirmOutcome = { kind: "refund" } | { kind: "booked"; bookingId: number };

// Razorpay amounts are in the smallest currency unit -- paise, not rupees.
function rupeesToPaise(amount: number): number {
  return Math.round(amount * 100);
}

export class PaymentService {
  constructor(
    private readonly seatRepository: SeatRepository,
    private readonly razorpay: Razorpay = razorpayClient,
    private readonly emailSender: EmailSender = new ResendEmailSender()
  ) {}

  // Plain (non-locking) read: this step calls out to Razorpay, and a
  // Postgres row lock must never be held open across an external network
  // call. This is a best-effort UX check, not the authoritative one -- that
  // happens in confirmPayment, locked, once the webhook actually arrives.
  async createOrder(
    showId: number,
    seatIds: number[],
    userId: number
  ): Promise<{ orderId: string; paymentId: number; amount: number; currency: string; keyId: string }> {
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

    const order = await withRetry(
      () =>
        this.razorpay.orders.create({
          amount: rupeesToPaise(amount),
          currency: "INR",
          notes: { userId: String(userId), showId: String(showId), seatIds: uniqueSeatIds.join(",") },
        }),
      { ...config.resilience, isRetryable: isRetryableRazorpayError }
    );

    const payment = await prisma.payment.create({
      data: {
        userId,
        showId,
        seatIds: uniqueSeatIds,
        razorpayOrderId: order.id,
        amount,
        status: PaymentStatus.PENDING,
      },
    });

    return { orderId: order.id, paymentId: payment.id, amount, currency: "INR", keyId: config.razorpay.keyId };
  }

  // Called once a verified `payment.captured` webhook event arrives.
  async confirmPayment(razorpayOrderId: string, razorpayPaymentId: string): Promise<void> {
    const paymentRow = await prisma.payment.findUnique({ where: { razorpayOrderId } });
    if (!paymentRow) {
      console.error(`Webhook confirmed an unknown order: ${razorpayOrderId}`);
      return;
    }
    if (paymentRow.status !== PaymentStatus.PENDING) {
      // Already resolved -- a duplicate/out-of-order webhook beyond the event-id check.
      return;
    }

    const outcome = await withRetry(
      () =>
        prisma.$transaction(async (tx): Promise<ConfirmOutcome> => {
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
            // The race case (SRS edge cases): payment succeeded, but the
            // hold didn't survive. Decision: refund-and-notify, not a grace
            // period -- see design notes. The actual Razorpay refund call
            // happens after this transaction commits, never inside it.
            payment.markFailed();
            await tx.payment.update({
              where: { id: paymentRow.id },
              data: { status: payment.status, razorpayPaymentId },
            });
            return { kind: "refund" };
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
            data: { status: payment.status, bookingId: payment.bookingId, razorpayPaymentId },
          });

          return { kind: "booked", bookingId: booking.id };
        }),
      { ...config.resilience, isRetryable: isRetryableDbError }
    );

    if (outcome.kind === "refund") {
      await withRetry(
        () => this.razorpay.payments.refund(razorpayPaymentId, { amount: rupeesToPaise(paymentRow.amount.toNumber()) }),
        { ...config.resilience, isRetryable: isRetryableRazorpayError }
      );
      console.error(
        `Refunded payment ${razorpayPaymentId}: hold expired before webhook confirmation arrived (race case, see SRS edge cases).`
      );
      return;
    }

    await this.sendBookingConfirmationEmail(outcome.bookingId, paymentRow.userId, paymentRow.showId, paymentRow.seatIds, paymentRow.amount.toNumber());
  }

  // Best-effort, and deliberately outside the DB transaction: a failed email
  // must never undo (or even retry) an already-confirmed booking. Razorpay
  // will retry the webhook on a 5xx, and confirmPayment is already
  // idempotent for that -- but making a flaky email provider the reason a
  // webhook delivery looks "failed" would be its own bug, so this just logs.
  private async sendBookingConfirmationEmail(
    bookingId: number,
    userId: number,
    showId: number,
    seatIds: number[],
    totalPrice: number
  ): Promise<void> {
    try {
      const [user, show, seats] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userId } }),
        prisma.show.findUniqueOrThrow({ where: { id: showId } }),
        prisma.seat.findMany({
          where: { id: { in: seatIds } },
          orderBy: [{ rowLabel: "asc" }, { seatNumber: "asc" }],
        }),
      ]);

      const message = await buildBookingConfirmationEmail({
        bookingId,
        userEmail: user.email,
        movieName: show.movieName,
        venue: show.venue,
        showtime: show.showtime,
        seatLabels: seats.map((seat) => `${seat.rowLabel}${seat.seatNumber}`),
        totalPrice,
      });

      await this.emailSender.send(message);
    } catch (error) {
      console.error(`Failed to send booking confirmation email for booking ${bookingId}:`, error);
    }
  }

  // Called on a verified `payment.failed` webhook event.
  async markPaymentFailed(razorpayOrderId: string, razorpayPaymentId?: string): Promise<void> {
    const paymentRow = await prisma.payment.findUnique({ where: { razorpayOrderId } });
    if (!paymentRow || paymentRow.status !== PaymentStatus.PENDING) {
      return;
    }

    // Per SRS section 7 + the UI/UX doc: the hold is left exactly as-is so
    // the user can retry within the remaining hold time without losing
    // their seat selection -- only the Payment row itself changes.
    const payment = new Payment({ ...paymentRow, amount: paymentRow.amount.toNumber() });
    payment.markFailed();
    await prisma.payment.update({
      where: { id: paymentRow.id },
      data: { status: payment.status, ...(razorpayPaymentId ? { razorpayPaymentId } : {}) },
    });
  }
}
