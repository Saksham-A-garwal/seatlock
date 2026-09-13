import { describe, expect, it, vi } from "vitest";
import { TimeoutError, withRetry } from "./withRetry";

const FAST_OPTIONS = { maxAttempts: 3, baseDelayMs: 5, timeoutMs: 200 };

describe("withRetry", () => {
  it("returns the result on the first attempt when it succeeds", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { ...FAST_OPTIONS, isRetryable: () => true });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries a retryable failure and succeeds once it stops failing", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { ...FAST_OPTIONS, isRetryable: () => true });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when isRetryable returns false -- fails on the first attempt", async () => {
    const businessError = new Error("409-style rejection");
    const fn = vi.fn().mockRejectedValue(businessError);

    await expect(withRetry(fn, { ...FAST_OPTIONS, isRetryable: () => false })).rejects.toBe(businessError);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still failing"));

    await expect(withRetry(fn, { ...FAST_OPTIONS, isRetryable: () => true })).rejects.toThrow("still failing");
    expect(fn).toHaveBeenCalledTimes(FAST_OPTIONS.maxAttempts);
  });

  it("treats a hang past the timeout as a failure and retries it", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise(() => {}); // never resolves -- simulates a hang
      }
      return Promise.resolve("recovered");
    });

    const result = await withRetry(fn, { maxAttempts: 2, baseDelayMs: 5, timeoutMs: 50, isRetryable: () => true });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("surfaces a TimeoutError if every attempt hangs", async () => {
    const fn = vi.fn().mockImplementation(() => new Promise(() => {}));

    await expect(
      withRetry(fn, { maxAttempts: 2, baseDelayMs: 5, timeoutMs: 30, isRetryable: () => true })
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
