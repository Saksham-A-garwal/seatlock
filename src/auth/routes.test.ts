import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../db/prisma";
import { redisClient } from "../rateLimit/redisClient";
import { FakeEmailSender } from "./FakeEmailSender";

function uniqueEmail(): string {
  return `route-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

// These routes share a per-IP rate limit (the whole "auth" route group), and
// every test in this file runs from the same source IP. Without resetting
// it, running the suite more than once inside the same 60s window would
// exhaust the real quota and start failing tests that have nothing to do
// with rate limiting.
async function resetAuthRateLimits(): Promise<void> {
  const keys = await redisClient.keys("ratelimit:auth:*");
  const otpEmailKeys = await redisClient.keys("ratelimit:otp-request:*");
  const allKeys = [...keys, ...otpEmailKeys];
  if (allKeys.length > 0) {
    await redisClient.del(...allKeys);
  }
}

describe("auth routes", () => {
  const createdEmails: string[] = [];

  beforeEach(resetAuthRateLimits);

  afterEach(async () => {
    await prisma.otpCode.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: createdEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    createdEmails.length = 0;
    await resetAuthRateLimits();
  });

  it("rejects an OTP request with an invalid email", async () => {
    const emailSender = new FakeEmailSender();
    const app = createApp({ emailSender });

    const res = await request(app).post("/auth/otp/request").send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_EMAIL");
  });

  it("completes the full OTP request -> verify -> refresh flow", async () => {
    const emailSender = new FakeEmailSender();
    const app = createApp({ emailSender });
    const email = uniqueEmail();
    createdEmails.push(email);

    const requestRes = await request(app).post("/auth/otp/request").send({ email });
    expect(requestRes.status).toBe(200);

    const code = emailSender.lastCodeFor(email);

    const wrongRes = await request(app).post("/auth/otp/verify").send({ email, code: "000000" });
    expect(wrongRes.status).toBe(400);
    expect(wrongRes.body.error.code).toBe("INCORRECT_CODE");

    const verifyRes = await request(app).post("/auth/otp/verify").send({ email, code });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.user.email).toBe(email);
    expect(verifyRes.body.accessToken).toBeTruthy();
    expect(verifyRes.body.refreshToken).toBeTruthy();

    const firstRefreshToken = verifyRes.body.refreshToken as string;

    const refreshRes = await request(app).post("/auth/refresh").send({ refreshToken: firstRefreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.refreshToken).not.toBe(firstRefreshToken);

    // The rotated-out token must now be rejected.
    const reuseRes = await request(app).post("/auth/refresh").send({ refreshToken: firstRefreshToken });
    expect(reuseRes.status).toBe(401);
  });

  it("rejects a refresh request with an unknown token", async () => {
    const app = createApp({ emailSender: new FakeEmailSender() });

    const res = await request(app).post("/auth/refresh").send({ refreshToken: "bogus-token" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
