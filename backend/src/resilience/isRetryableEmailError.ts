// Resend's SDK models an API-level rejection (bad request, sandbox
// restriction, etc.) as a resolved `{ error }` result, never a thrown
// exception -- see ResendEmailSender. So anything that actually reaches
// this predicate (a rejected promise from the raw send call) is by
// construction a transport-level failure, not a structured API rejection,
// and is safe to always treat as retryable.
export function isRetryableEmailError(_error: unknown): boolean {
  return true;
}
