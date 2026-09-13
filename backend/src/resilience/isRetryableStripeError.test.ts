import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { isRetryableStripeError } from "./isRetryableStripeError";

describe("isRetryableStripeError", () => {
  it("treats a Stripe connection error as retryable", () => {
    const error = new Stripe.errors.StripeConnectionError({ message: "network blip" });
    expect(isRetryableStripeError(error)).toBe(true);
  });

  it("treats a Stripe API (server-side, 5xx) error as retryable", () => {
    const error = new Stripe.errors.StripeAPIError({ message: "internal error", type: "api_error" });
    expect(isRetryableStripeError(error)).toBe(true);
  });

  it("treats a card decline as not retryable", () => {
    const error = new Stripe.errors.StripeCardError({ message: "card declined", type: "card_error" });
    expect(isRetryableStripeError(error)).toBe(false);
  });

  it("treats an invalid request error as not retryable", () => {
    const error = new Stripe.errors.StripeInvalidRequestError({ message: "bad param", type: "invalid_request_error" });
    expect(isRetryableStripeError(error)).toBe(false);
  });

  it("treats a plain Error as not retryable", () => {
    expect(isRetryableStripeError(new Error("unrelated"))).toBe(false);
  });
});
