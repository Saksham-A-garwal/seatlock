import Stripe from "stripe";
import { config } from "../config";

// Builds a genuinely validly-signed webhook payload/header pair using
// Stripe's own test helper -- this exercises the real signature-
// verification code path in tests, rather than bypassing it with a mock.
export function buildSignedWebhookPayload(eventBody: object): { payload: string; signature: string } {
  const payload = JSON.stringify(eventBody);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: config.stripeWebhookSecret,
  });
  return { payload, signature };
}

export function makeStripeEventBody(
  id: string,
  type: "payment_intent.succeeded" | "payment_intent.payment_failed",
  paymentIntentId: string
) {
  return {
    id,
    object: "event",
    type,
    data: {
      object: {
        id: paymentIntentId,
        object: "payment_intent",
      },
    },
  };
}
