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

  it("completes the full OTP request -> verify -> refresh -> logout flow", async () => {
    const emailSender = new FakeEmailSender();
    const app = createApp({ emailSender });
    // An agent persists cookies across requests, same as a real browser --
    // needed since the refresh token now travels as an httpOnly cookie, not
    // in the JSON body.
    const agent = request.agent(app);
    const email = uniqueEmail();
    createdEmails.push(email);

    const requestRes = await agent.post("/auth/otp/request").send({ email });
    expect(requestRes.status).toBe(200);

    const code = emailSender.lastCodeFor(email);

    const wrongRes = await agent.post("/auth/otp/verify").send({ email, code: "000000" });
    expect(wrongRes.status).toBe(400);
    expect(wrongRes.body.error.code).toBe("INCORRECT_CODE");

    const verifyRes = await agent.post("/auth/otp/verify").send({ email, code });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.user.email).toBe(email);
    expect(verifyRes.body.accessToken).toBeTruthy();
    expect(verifyRes.body.refreshToken).toBeUndefined(); // never in the JSON body
    const setCookieHeader = verifyRes.headers["set-cookie"];
    expect(setCookieHeader?.[0]).toMatch(/^refreshToken=.*HttpOnly/);

    const refreshRes = await agent.post("/auth/refresh");
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).toBeUndefined();

    const logoutRes = await agent.post("/auth/logout");
    expect(logoutRes.status).toBe(200);

    // The (already-rotated-out, and now also revoked) cookie the agent still
    // holds must be rejected.
    const afterLogoutRes = await agent.post("/auth/refresh");
    expect(afterLogoutRes.status).toBe(401);
  });

  it("rejects a refresh request with no cookie at all", async () => {
    const app = createApp({ emailSender: new FakeEmailSender() });

    const res = await request(app).post("/auth/refresh");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a refresh request with an unknown token in the cookie", async () => {
    const app = createApp({ emailSender: new FakeEmailSender() });

    const res = await request(app).post("/auth/refresh").set("Cookie", ["refreshToken=bogus-token"]);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects reusing a refresh token after it has been rotated", async () => {
    const emailSender = new FakeEmailSender();
    const app = createApp({ emailSender });
    const email = uniqueEmail();
    createdEmails.push(email);

    await request(app).post("/auth/otp/request").send({ email });
    const code = emailSender.lastCodeFor(email);
    const verifyRes = await request(app).post("/auth/otp/verify").send({ email, code });
    const originalCookie = verifyRes.headers["set-cookie"][0] as string;

    // Rotate once using the original cookie.
    await request(app).post("/auth/refresh").set("Cookie", [originalCookie]);

    // Presenting the SAME (now rotated-out) cookie again must be rejected.
    const reuseRes = await request(app).post("/auth/refresh").set("Cookie", [originalCookie]);
    expect(reuseRes.status).toBe(401);
  });
});
