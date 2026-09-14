import { createHmac } from "crypto";
import { config } from "../config";

// Builds a genuinely validly-signed webhook payload using the exact
// algorithm Razorpay documents (HMAC-SHA256 of the raw body, keyed by the
// webhook secret) -- this exercises the real signature-verification code
// path in tests, rather than bypassing it with a mock. Razorpay's SDK only
// ships a *validator* (Razorpay.validateWebhookSignature), not a test-signing
// helper the way Stripe does, so this mirrors that same formula directly.
export function buildSignedWebhookPayload(eventBody: object): { payload: string; signature: string } {
  const payload = JSON.stringify(eventBody);
  const signature = createHmac("sha256", config.razorpay.webhookSecret).update(payload).digest("hex");
  return { payload, signature };
}

export function makeRazorpayEventBody(
  event: "payment.captured" | "payment.failed",
  razorpayPaymentId: string,
  razorpayOrderId: string
) {
  return {
    entity: "event",
    event,
    payload: {
      payment: {
        entity: {
          id: razorpayPaymentId,
          order_id: razorpayOrderId,
        },
      },
    },
  };
}
