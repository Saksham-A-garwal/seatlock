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

  it("reuse revokes the ENTIRE family, not just the reused token -- the legitimate next token dies too", async () => {
    const { refreshToken: token1 } = await issueTokenPair(user.id, user.role);
    const { refreshToken: token2 } = await rotateRefreshToken(token1); // legitimate rotation

    // token1 comes back -- an attacker replaying a stolen copy, or the
    // rightful owner's own stale tab. Either way, this must not be treated
    // as "just this one request is wrong".
    await expect(rotateRefreshToken(token1)).rejects.toThrow(AuthTokenError);

    // token2 was never reused, never expired, and was legitimately issued
    // -- but it's in the same family as token1, so it must be dead too.
    await expect(rotateRefreshToken(token2)).rejects.toThrow(AuthTokenError);
  });

  it("a fresh login starts a new family, unaffected by another session's reuse-triggered revocation", async () => {
    const { refreshToken: sessionAToken1 } = await issueTokenPair(user.id, user.role);
    const { refreshToken: sessionBToken } = await issueTokenPair(user.id, user.role); // a second, independent login

    await rotateRefreshToken(sessionAToken1);
    await expect(rotateRefreshToken(sessionAToken1)).rejects.toThrow(AuthTokenError); // triggers session A's revocation

    // Session B was never touched -- a different login must not be
    // collateral damage from another session's compromise.
    const rotatedB = await rotateRefreshToken(sessionBToken);
    expect(rotatedB.accessToken).toBeTruthy();
  });

  it("rejects an unknown refresh token", async () => {
    await expect(rotateRefreshToken("not-a-real-refresh-token")).rejects.toThrow(AuthTokenError);
  });

  it("rotating the same token twice, genuinely concurrently, lets exactly one call win -- and the loser's detection revokes the winner's new token too", async () => {
    const { refreshToken } = await issueTokenPair(user.id, user.role);

    const results = await Promise.allSettled([rotateRefreshToken(refreshToken), rotateRefreshToken(refreshToken)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof rotateRefreshToken>>
    >[];
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AuthTokenError);

    // The genuinely concurrent second attempt looks, from the server's
    // side, identical to a real reuse attack (the same token presented
    // twice) -- so it correctly revokes the family, which means even the
    // "winning" call's brand-new token is now dead too. This is the known,
    // accepted multi-tab tradeoff documented on rotateRefreshToken.
    const winnersNewToken = fulfilled[0].value.refreshToken;
    await expect(rotateRefreshToken(winnersNewToken)).rejects.toThrow(AuthTokenError);
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
