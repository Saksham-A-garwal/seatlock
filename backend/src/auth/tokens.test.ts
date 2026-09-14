import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "crypto";
import { Role, User } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthTokenError } from "./errors";
import { issueTokenPair, rotateRefreshToken, verifyAccessToken } from "./tokens";

function uniqueEmail(): string {
  return `token-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe("tokens", () => {
  let user: User;

  beforeAll(async () => {
    user = await prisma.user.create({
      data: { email: uniqueEmail(), emailVerified: true, role: Role.USER },
    });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("issues an access token that verifies back to the same user/role", async () => {
    const { accessToken } = await issueTokenPair(user.id, user.role);
    const payload = verifyAccessToken(accessToken);

    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe(user.role);
  });

  it("rejects a garbage access token", () => {
    expect(() => verifyAccessToken("not-a-real-token")).toThrow();
  });

  it("rotates a valid refresh token into a new pair", async () => {
    const { refreshToken } = await issueTokenPair(user.id, user.role);
    const rotated = await rotateRefreshToken(refreshToken);

    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(refreshToken);
  });

  it("rejects reusing an already-rotated refresh token", async () => {
    const { refreshToken } = await issueTokenPair(user.id, user.role);
    await rotateRefreshToken(refreshToken);

    await expect(rotateRefreshToken(refreshToken)).rejects.toThrow(AuthTokenError);
  });

  it("rejects an unknown refresh token", async () => {
    await expect(rotateRefreshToken("not-a-real-refresh-token")).rejects.toThrow(AuthTokenError);
  });

  it("rotating the same token twice, genuinely concurrently, lets exactly one call win", async () => {
    const { refreshToken } = await issueTokenPair(user.id, user.role);

    const results = await Promise.allSettled([rotateRefreshToken(refreshToken), rotateRefreshToken(refreshToken)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AuthTokenError);
  });

  it("rejects an expired refresh token", async () => {
    const { refreshToken } = await issueTokenPair(user.id, user.role);
    const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");

    await prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(rotateRefreshToken(refreshToken)).rejects.toThrow(AuthTokenError);
  });
});
