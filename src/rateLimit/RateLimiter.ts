import { Redis } from "@upstash/redis";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Fixed-window counter: INCR the key, set its expiry on the first hit in
// the window, reject once the count passes max. Simple and explainable
// over a sliding-window log/counter, which this scope doesn't need.
export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  async checkLimit(key: string, windowSeconds: number, max: number): Promise<RateLimitResult> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
    }

    if (count > max) {
      const ttl = await this.redis.ttl(key);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }
}
