import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Prisma, Role } from "@prisma/client";
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

// Accepts either the top-level client or an open transaction, so the same
// token-issuing code can run standalone (sign-in) or inside the locked
// transaction rotateRefreshToken needs (refresh).
type DbClient = typeof prisma | Prisma.TransactionClient;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(userId: number, role: Role): string {
  const payload: AccessTokenPayload = { sub: userId, role };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: `${config.accessTokenTtlMinutes}m` });
}

async function createRefreshToken(db: DbClient, userId: number): Promise<string> {
  const rawToken = crypto.randomBytes(40).toString("base64url");
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await db.refreshToken.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt },
  });

  return rawToken;
}

export async function issueTokenPair(userId: number, role: Role, db: DbClient = prisma): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(userId, role),
    createRefreshToken(db, userId),
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

interface RefreshTokenRow {
  id: number;
  userId: number;
  usedAt: Date | null;
  expiresAt: Date;
}

// Single-use rotation, no reuse-detection (deliberate scope cut): presenting
// an already-used or expired token is simply rejected, not treated as a
// signal to revoke every other session for the user.
//
// The read-check-update below runs inside one transaction with the row
// locked FOR UPDATE -- the exact same reason SeatRepository.lockForUpdate
// exists. Without it, two concurrent refresh calls (the frontend firing a
// refresh from two requests that 401'd around the same moment, or two
// browser tabs) can both read usedAt=null before either write lands, both
// pass the check, and both mint a new token pair from the same presented
// token -- a correctness bug, not just a wasted request.
export async function rotateRefreshToken(rawToken: string): Promise<TokenPair> {
  const hash = hashToken(rawToken);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<RefreshTokenRow[]>`
      SELECT id, "userId", "usedAt", "expiresAt"
      FROM "RefreshToken"
      WHERE "tokenHash" = ${hash}
      FOR UPDATE
    `;
    const existing = rows[0];

    if (!existing) {
      throw new AuthTokenError("Invalid refresh token");
    }
    if (existing.usedAt !== null) {
      throw new AuthTokenError("Refresh token has already been used");
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      throw new AuthTokenError("Refresh token has expired");
    }

    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { usedAt: new Date() },
    });

    const user = await tx.user.findUniqueOrThrow({ where: { id: existing.userId } });
    return issueTokenPair(user.id, user.role, tx);
  });
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
