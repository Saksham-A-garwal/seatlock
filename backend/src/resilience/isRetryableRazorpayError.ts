// Razorpay's Node SDK doesn't throw a custom Error subclass for an API-level
// rejection -- it rejects with a plain object shaped { statusCode, error }
// (see node_modules/razorpay/dist/types/api.d.ts, INormalizeError). A
// connection-level failure (server unreachable, DNS failure, timed out
// connecting) never reaches that normalization step at all and surfaces as
// axios's own error instead, with no statusCode. Both shapes are checked
// explicitly below -- anything that matches neither (including every one of
// our own thrown domain errors, which are plain Error subclasses with
// neither field) falls through to `false`, the same "structurally can't be
// misretried" guarantee isRetryableDbError has.
interface RazorpayNormalizedError {
  statusCode?: string | number;
}

interface AxiosLikeError {
  isAxiosError: true;
  code?: string;
  response?: unknown;
}

// Connection-establishment failures only -- never a business outcome.
const RETRYABLE_NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ECONNABORTED"]);

function hasStatusCode(error: unknown): error is RazorpayNormalizedError {
  return typeof error === "object" && error !== null && "statusCode" in error;
}

function isRetryableAxiosNetworkError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as Partial<AxiosLikeError>;
  return (
    candidate.isAxiosError === true &&
    candidate.response === undefined &&
    RETRYABLE_NETWORK_CODES.has(candidate.code ?? "")
  );
}

// Retry only Razorpay's own transport/server-side failures. A 4xx (bad
// request, an unauthorized key, a card decline, a VPA that rejects the
// collect request) is a permanent outcome for this attempt -- retrying it
// wastes time and, for a declined payment, would be actively misleading to
// the user.
export function isRetryableRazorpayError(error: unknown): boolean {
  if (hasStatusCode(error)) {
    const statusCode = Number(error.statusCode);
    return Number.isFinite(statusCode) && statusCode >= 500;
  }
  return isRetryableAxiosNetworkError(error);
}
