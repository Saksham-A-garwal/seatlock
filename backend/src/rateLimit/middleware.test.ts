import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Role } from "@prisma/client";
import { redisClient } from "./redisClient";
import { RateLimiter } from "./RateLimiter";
import { rateLimitByEmail, rateLimitByIp, rateLimitByUser } from "./middleware";

function uniquePrefix(): string {
  return `test-mw:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

describe("rate limit middleware", () => {
  const rateLimiter = new RateLimiter(redisClient);
  const keysToClean: string[] = [];

  afterEach(async () => {
    await Promise.all(keysToClean.map((key) => redisClient.del(key)));
    keysToClean.length = 0;
  });

  describe("rateLimitByIp", () => {
    it("allows requests under the limit and blocks the one over it", async () => {
      const prefix = uniquePrefix();
      const app = express();
      app.get("/ping", rateLimitByIp(rateLimiter, { keyPrefix: prefix, windowSeconds: 60, max: 2 }), (_req, res) =>
        res.status(200).json({ ok: true })
      );

      const first = await request(app).get("/ping");
      const second = await request(app).get("/ping");
      const third = await request(app).get("/ping");

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe("RATE_LIMITED");

      // No explicit cleanup needed: the key prefix is random per test, and
      // the 60s window means any leftover key just expires on its own.
    });
  });

  describe("rateLimitByEmail", () => {
    it("keys on the request body's email and lets a missing email through untouched", async () => {
      const prefix = uniquePrefix();
      const app = express();
      app.use(express.json());
      app.post(
        "/ping",
        rateLimitByEmail(rateLimiter, { keyPrefix: prefix, windowSeconds: 60, max: 1 }),
        (_req, res) => res.status(200).json({ ok: true })
      );

      const noEmail = await request(app).post("/ping").send({});
      expect(noEmail.status).toBe(200); // nothing to key on -- falls through to the route

      const email = "ratelimit-test@example.com";
      const first = await request(app).post("/ping").send({ email });
      const second = await request(app).post("/ping").send({ email });

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);

      keysToClean.push(`ratelimit:${prefix}:email:${email}`);
    });
  });

  describe("rateLimitByUser", () => {
    it("keys on req.auth.id", async () => {
      const prefix = uniquePrefix();
      const app = express();
      app.use((req, _res, next) => {
        req.auth = { id: 999999, role: Role.USER };
        next();
      });
      app.get(
        "/ping",
        rateLimitByUser(rateLimiter, { keyPrefix: prefix, windowSeconds: 60, max: 1 }),
        (_req, res) => res.status(200).json({ ok: true })
      );

      const first = await request(app).get("/ping");
      const second = await request(app).get("/ping");

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);

      keysToClean.push(`ratelimit:${prefix}:user:999999`);
    });
  });

  describe("fail-open behavior", () => {
    it("lets the request through if the rate limiter itself throws", async () => {
      const brokenLimiter = {
        checkLimit: () => Promise.reject(new Error("Redis is unreachable")),
      } as unknown as RateLimiter;

      const app = express();
      app.get(
        "/ping",
        rateLimitByIp(brokenLimiter, { keyPrefix: "broken", windowSeconds: 60, max: 1 }),
        (_req, res) => res.status(200).json({ ok: true })
      );

      const res = await request(app).get("/ping");
      expect(res.status).toBe(200);
    });
  });
});
