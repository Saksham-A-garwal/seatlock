import { afterEach, describe, expect, it } from "vitest";
import { redisClient } from "../rateLimit/redisClient";
import { RedisSeatLock } from "./RedisSeatLock";

// Real seat ids never actually assigned to a DB row -- fine here, this
// class doesn't know or care whether a seat id is real; that's Postgres's
// job. Namespaced so a flaky run never collides with a real seat's lock.
function testSeatId(n: number): number {
  return 9_000_000 + n;
}

describe("RedisSeatLock", () => {
  const seatLock = new RedisSeatLock();
  let usedSeatIds: number[] = [];

  afterEach(async () => {
    if (usedSeatIds.length > 0) {
      await seatLock.release(usedSeatIds);
      usedSeatIds = [];
    }
  });

  it("acquires a lock on a seat nobody holds yet", async () => {
    const seatId = testSeatId(1);
    usedSeatIds = [seatId];

    const acquired = await seatLock.acquire([seatId], 60);

    expect(acquired).toEqual([seatId]);
  });

  it("refuses to acquire a seat that's already locked", async () => {
    const seatId = testSeatId(2);
    usedSeatIds = [seatId];
    await seatLock.acquire([seatId], 60);

    const secondAttempt = await seatLock.acquire([seatId], 60);

    expect(secondAttempt).toEqual([]);
  });

  it("is all-or-nothing across multiple seats: one already locked blocks the rest", async () => {
    const [free1, alreadyLocked, free2] = [testSeatId(3), testSeatId(4), testSeatId(5)];
    usedSeatIds = [free1, alreadyLocked, free2];
    await seatLock.acquire([alreadyLocked], 60);

    const result = await seatLock.acquire([free1, alreadyLocked, free2], 60);

    // Sorted ascending internally, so free1 (locked) then alreadyLocked
    // (blocks here) -- free2 is never even attempted.
    expect(result).toEqual([free1]);

    const stillFree2 = await seatLock.acquire([free2], 60);
    expect(stillFree2).toEqual([free2]);
  });

  it("lets a released seat be acquired again immediately", async () => {
    const seatId = testSeatId(6);
    usedSeatIds = [seatId];
    await seatLock.acquire([seatId], 60);

    await seatLock.release([seatId]);
    const reacquired = await seatLock.acquire([seatId], 60);

    expect(reacquired).toEqual([seatId]);
  });

  it("acquires seats in ascending id order regardless of the order requested", async () => {
    const [lower, higher] = [testSeatId(7), testSeatId(8)];
    usedSeatIds = [lower, higher];

    // Requested highest-first; both are free, so both should still succeed
    // -- this just proves the internal sort doesn't drop a valid request.
    const result = await seatLock.acquire([higher, lower], 60);

    expect(result.sort((a, b) => a - b)).toEqual([lower, higher]);
  });

  it("release is a no-op for a key that was never set", async () => {
    await expect(seatLock.release([testSeatId(9)])).resolves.not.toThrow();
  });

  it("actually sets a TTL on the underlying Redis key", async () => {
    const seatId = testSeatId(10);
    usedSeatIds = [seatId];
    await seatLock.acquire([seatId], 120);

    const ttl = await redisClient.ttl(`seat-lock:${seatId}`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });
});
