import { afterEach, describe, expect, it } from "vitest";
import { redisClient } from "./redisClient";
import { RateLimiter } from "./RateLimiter";

function uniqueKey(): string {
  return `test-ratelimit:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

describe("RateLimiter", () => {
  const rateLimiter = new RateLimiter(redisClient);
  let usedKey: string | undefined;

  afterEach(async () => {
    if (usedKey) await redisClient.del(usedKey);
    usedKey = undefined;
  });

  it("allows requests up to the limit", async () => {
    usedKey = uniqueKey();

    for (let i = 0; i < 3; i++) {
      const result = await rateLimiter.checkLimit(usedKey, 60, 3);
      expect(result.allowed).toBe(true);
    }
  });

  it("rejects the request that pushes the count past the limit", async () => {
    usedKey = uniqueKey();

    for (let i = 0; i < 3; i++) {
      await rateLimiter.checkLimit(usedKey, 60, 3);
    }
    const result = await rateLimiter.checkLimit(usedKey, 60, 3);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps rejecting further requests within the same window", async () => {
    usedKey = uniqueKey();

    for (let i = 0; i < 3; i++) {
      await rateLimiter.checkLimit(usedKey, 60, 3);
    }
    const first = await rateLimiter.checkLimit(usedKey, 60, 3);
    const second = await rateLimiter.checkLimit(usedKey, 60, 3);

    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
  });

  it("allows requests again once the window has passed", async () => {
    usedKey = uniqueKey();

    for (let i = 0; i < 2; i++) {
      await rateLimiter.checkLimit(usedKey, 1, 2); // 1-second window, max 2
    }
    const blocked = await rateLimiter.checkLimit(usedKey, 1, 2);
    expect(blocked.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const afterWindow = await rateLimiter.checkLimit(usedKey, 1, 2);
    expect(afterWindow.allowed).toBe(true);
  }, 10_000);

  it("tracks separate keys independently", async () => {
    const keyA = uniqueKey();
    const keyB = uniqueKey();

    await rateLimiter.checkLimit(keyA, 60, 1);
    const resultA = await rateLimiter.checkLimit(keyA, 60, 1);
    const resultB = await rateLimiter.checkLimit(keyB, 60, 1);

    expect(resultA.allowed).toBe(false); // keyA is now over its limit of 1
    expect(resultB.allowed).toBe(true); // keyB is untouched

    await redisClient.del(keyA);
    await redisClient.del(keyB);
  });
});
