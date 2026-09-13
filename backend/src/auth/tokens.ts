import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db/prisma";
import { AuthTokenError } from "./errors";

interface AccessTokenPayload {
  sub: number;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(userId: number, role: Role): string {
  const payload: AccessTokenPayload = { sub: userId, role };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: `${config.accessTokenTtlMinutes}m` });
}

async function createRefreshToken(userId: number): Promise<string> {
  const rawToken = crypto.randomBytes(40).toString("base64url");
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt },
  });

  return rawToken;
}

export async function issueTokenPair(userId: number, role: Role): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(userId, role),
    createRefreshToken(userId),
  ]);
  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, config.jwtSecret) as unknown as AccessTokenPayload;
  } catch {
    throw new AuthTokenError("Invalid or expired access token");
  }
}

// Single-use rotation, no reuse-detection (deliberate scope cut): presenting
// an already-used or expired token is simply rejected, not treated as a
// signal to revoke every other session for the user.
export async function rotateRefreshToken(rawToken: string): Promise<TokenPair> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });

  if (!existing) {
    throw new AuthTokenError("Invalid refresh token");
  }
  if (existing.usedAt !== null) {
    throw new AuthTokenError("Refresh token has already been used");
  }
  if (existing.expiresAt.getTime() < Date.now()) {
    throw new AuthTokenError("Refresh token has expired");
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { usedAt: new Date() },
  });

  return issueTokenPair(existing.userId, existing.user.role);
}

// Logout: marks the token used (if it's a real, still-valid one) so a
// stolen cookie can't be replayed after the user has logged out. A
// missing/already-used/unknown token is not an error here -- logout should
// always succeed from the client's point of view.
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), usedAt: null },
    data: { usedAt: new Date() },
  });
}
