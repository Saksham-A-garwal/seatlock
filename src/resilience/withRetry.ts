export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      });
  });
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  timeoutMs: number;
  // Only errors this returns true for are retried. Anything else (including
  // every one of our own thrown domain errors, since they're never an
  // instance of the specific transient-error types a predicate checks for)
  // propagates immediately on the first attempt -- this is what makes it
  // structurally impossible to retry a correct business rejection like a
  // 409, rather than something that has to be remembered to scope right.
  isRetryable: (error: unknown) => boolean;
}

// <T> here just means "whatever type fn() resolves to, withRetry resolves
// to that same type" -- the function works for any async call without
// needing a separate copy per return type.
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await withTimeout(fn(), options.timeoutMs);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === options.maxAttempts;
      if (!options.isRetryable(error) || isLastAttempt) {
        throw error;
      }
      const backoff = options.baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * backoff * 0.5;
      await sleep(backoff + jitter);
    }
  }

  // Unreachable (the loop always returns or throws), but keeps TS happy
  // without asserting a type it can't otherwise prove.
  throw lastError;
}
