import Stripe from "stripe";

// Retry only Stripe's own transport/server-side failures. A card decline,
// an invalid request, or a bad API key are permanent outcomes for this
// attempt -- retrying them wastes time and (for a card decline) would be
// actively misleading to the user.
export function isRetryableStripeError(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError
  );
}
