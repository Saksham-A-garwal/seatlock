import { NextFunction, Request, Response } from "express";
import { RateLimiter } from "./RateLimiter";

interface RateLimitOptions {
  keyPrefix: string;
  windowSeconds: number;
  max: number;
}

function respondRateLimited(res: Response, retryAfterSeconds: number): void {
  res.status(429).json({
    error: { code: "RATE_LIMITED", message: `Too many requests. Try again in ${retryAfterSeconds} second(s).` },
  });
}

// Fails open: if Redis itself is unreachable, the request is let through
// (and logged) rather than a rate-limiter outage taking down the whole API.
async function applyLimit(
  rateLimiter: RateLimiter,
  key: string,
  options: RateLimitOptions,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await rateLimiter.checkLimit(key, options.windowSeconds, options.max);
    if (!result.allowed) {
      respondRateLimited(res, result.retryAfterSeconds);
      return;
    }
    next();
  } catch (error) {
    console.error("Rate limiter check failed; letting the request through:", error);
    next();
  }
}

export function rateLimitByIp(rateLimiter: RateLimiter, options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `ratelimit:${options.keyPrefix}:ip:${req.ip}`;
    void applyLimit(rateLimiter, key, options, res, next);
  };
}

// Must be mounted after requireAuth -- reads req.auth.
export function rateLimitByUser(rateLimiter: RateLimiter, options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `ratelimit:${options.keyPrefix}:user:${req.auth!.id}`;
    void applyLimit(rateLimiter, key, options, res, next);
  };
}

export function rateLimitByEmail(rateLimiter: RateLimiter, options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof email !== "string" || email.length === 0) {
      // No email to key on -- the route's own validation will reject this.
      next();
      return;
    }
    const key = `ratelimit:${options.keyPrefix}:email:${email.toLowerCase()}`;
    void applyLimit(rateLimiter, key, options, res, next);
  };
}
