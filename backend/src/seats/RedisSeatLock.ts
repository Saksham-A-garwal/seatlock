import { Redis } from "@upstash/redis";
import { redisClient } from "../rateLimit/redisClient";

const KEY_PREFIX = "seat-lock:";

function keyFor(seatId: number): string {
  return `${KEY_PREFIX}${seatId}`;
}

// A fast, disposable pre-check in front of the database's own row lock --
// not a second source of truth. SET ... NX EX gives an instant yes/no with
// no queueing (Redis never blocks waiting for a key the way a Postgres row
// lock blocks waiting for a row), so a hold attempt that was always going
// to lose never has to wait behind everyone else just to find that out.
//
// If this cache is ever wrong -- a key that should have been cleared but
// wasn't -- the only possible failure is a request being told "taken" for a
// seat that's actually free, which self-corrects once the key's own TTL
// runs out. It can never cause the opposite (wrongly saying "free" for a
// seat someone holds), because HoldService still runs the real Postgres
// transaction afterward regardless of what this says.
export class RedisSeatLock {
  constructor(private readonly redis: Redis = redisClient) {}

  // Acquired in ascending seat-id order, one at a time, stopping at the
  // first failure -- the same reason SeatRepository.lockForUpdate orders
  // its Postgres lock acquisition by id. Without a consistent order here,
  // two requests wanting the same two seats in different orders could each
  // grab one and neither ever get both, even though Postgres (which *does*
  // order consistently) would have let exactly one of them through. Redis
  // can't deadlock the way blocking locks can -- SET NX never waits, it
  // just immediately succeeds or fails -- but an inconsistent order still
  // produces this same "everyone loses" outcome, so the fix is the same one.
  async acquire(seatIds: number[], ttlSeconds: number): Promise<number[]> {
    const sorted = [...seatIds].sort((a, b) => a - b);
    const acquired: number[] = [];
    for (const seatId of sorted) {
      const result = await this.redis.set(keyFor(seatId), "1", { nx: true, ex: ttlSeconds });
      if (result !== "OK") break;
      acquired.push(seatId);
    }
    return acquired;
  }

  async release(seatIds: number[]): Promise<void> {
    if (seatIds.length === 0) return;
    await this.redis.del(...seatIds.map(keyFor));
  }
}
