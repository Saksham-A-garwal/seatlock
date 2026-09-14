import { PaymentStatus } from "@prisma/client";
import { InvalidPaymentTransitionError } from "./errors";

interface PaymentData {
  id: number;
  userId: number;
  showId: number;
  seatIds: number[];
  razorpayOrderId: string;
  amount: number;
  status?: PaymentStatus;
  bookingId?: number | null;
}

export class Payment {
  readonly id: number;
  readonly userId: number;
  readonly showId: number;
  readonly seatIds: number[];
  readonly razorpayOrderId: string;
  readonly amount: number;
  status: PaymentStatus;
  bookingId: number | null;

  constructor(data: PaymentData) {
    this.id = data.id;
    this.userId = data.userId;
    this.showId = data.showId;
    this.seatIds = data.seatIds;
    this.razorpayOrderId = data.razorpayOrderId;
    this.amount = data.amount;
    this.status = data.status ?? PaymentStatus.PENDING;
    this.bookingId = data.bookingId ?? null;
  }

  // FR-4a: a payment only reaches SUCCEEDED once a verified webhook confirms
  // it AND the hold survived until then (checked by the caller before this).
  markSucceeded(bookingId: number): void {
    if (this.status !== PaymentStatus.PENDING) {
      throw new InvalidPaymentTransitionError(this.status, PaymentStatus.SUCCEEDED);
    }
    this.status = PaymentStatus.SUCCEEDED;
    this.bookingId = bookingId;
  }

  markFailed(): void {
    if (this.status !== PaymentStatus.PENDING) {
      throw new InvalidPaymentTransitionError(this.status, PaymentStatus.FAILED);
    }
    this.status = PaymentStatus.FAILED;
  }
}
