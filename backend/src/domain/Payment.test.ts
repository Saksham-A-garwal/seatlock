import { describe, expect, it } from "vitest";
import { PaymentStatus } from "@prisma/client";
import { Payment } from "./Payment";
import { InvalidPaymentTransitionError } from "./errors";

function makePayment(overrides: Partial<ConstructorParameters<typeof Payment>[0]> = {}): Payment {
  return new Payment({
    id: 1,
    userId: 1,
    showId: 1,
    seatIds: [1, 2],
    stripePaymentIntentId: "pi_test_123",
    amount: 500,
    ...overrides,
  });
}

describe("Payment construction", () => {
  it("defaults to PENDING with no bookingId", () => {
    const payment = makePayment();
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.bookingId).toBeNull();
  });
});

describe("Payment.markSucceeded", () => {
  it("moves a PENDING payment to SUCCEEDED and records the booking", () => {
    const payment = makePayment();
    payment.markSucceeded(42);

    expect(payment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payment.bookingId).toBe(42);
  });

  it("rejects succeeding a payment that is already SUCCEEDED", () => {
    const payment = makePayment({ status: PaymentStatus.SUCCEEDED });
    expect(() => payment.markSucceeded(42)).toThrow(InvalidPaymentTransitionError);
  });

  it("rejects succeeding a payment that already FAILED", () => {
    const payment = makePayment({ status: PaymentStatus.FAILED });
    expect(() => payment.markSucceeded(42)).toThrow(InvalidPaymentTransitionError);
  });
});

describe("Payment.markFailed", () => {
  it("moves a PENDING payment to FAILED", () => {
    const payment = makePayment();
    payment.markFailed();
    expect(payment.status).toBe(PaymentStatus.FAILED);
  });

  it("rejects failing a payment that already SUCCEEDED", () => {
    const payment = makePayment({ status: PaymentStatus.SUCCEEDED, bookingId: 42 });
    expect(() => payment.markFailed()).toThrow(InvalidPaymentTransitionError);
  });

  it("rejects failing a payment that already FAILED", () => {
    const payment = makePayment({ status: PaymentStatus.FAILED });
    expect(() => payment.markFailed()).toThrow(InvalidPaymentTransitionError);
  });
});
