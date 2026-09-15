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

async function createRefreshToken(db: DbClient, userId: number, familyId: string): Promise<string> {
  const rawToken = crypto.randomBytes(40).toString("base64url");
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  await db.refreshToken.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt, familyId },
  });

  return rawToken;
}

// familyId is omitted on a fresh sign-in (Google/OTP), which starts a brand
// new chain, and passed through by rotateRefreshToken to keep a rotated
// token in the same chain as the one it replaced -- that chain is the unit
// reuse-detection revokes, not any single token.
export async function issueTokenPair(
  userId: number,
  role: Role,
  db: DbClient = prisma,
  familyId: string = crypto.randomBytes(16).toString("hex")
): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(userId, role),
    createRefreshToken(db, userId, familyId),
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
  familyId: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}

// What actually happened is decided and persisted entirely inside the
// transaction below; what to throw is decided afterward, from this result
// -- never inside the transaction. Prisma rolls back every write an
// interactive transaction's callback made if that callback throws, which
// would silently undo the family-wide revocation this function exists to
// make durable at the exact moment it's detecting an attack.
type RotationOutcome =
  | { kind: "invalid" }
  | { kind: "reused"; userId: number; familyId: string }
  | { kind: "expired" }
  | { kind: "rotated"; tokens: TokenPair };

// Single-use rotation WITH reuse-detection: presenting a token that's
// already been rotated (or already revoked) doesn't just fail this one
// request -- it revokes every token in its family. A legitimate client only
// ever holds the newest token in its chain; it can never legitimately end
// up presenting an old one again. Seeing an old one come back means two
// parties have this chain (a stolen cookie, most likely), so the whole
// chain is killed rather than just this one attempt, forcing a real
// re-login instead of quietly trusting a chain someone else also holds.
//
// Known, accepted tradeoff: two legitimate browser tabs for the same user
// can independently race a refresh on the same underlying cookie (the
// in-flight-promise dedup in the frontend's api client only dedupes within
// one tab, not across tabs). That race looks identical to a real reuse
// attack from the server's point of view, so it also triggers a full
// revocation -- both tabs get logged out rather than one silently losing a
// race. This is the standard, conservative call reuse-detection makes: a
// forced re-login is a minor inconvenience next to silently letting a
// stolen refresh token keep working.
//
// The read-check-update below runs inside one transaction with the row
// locked FOR UPDATE -- the exact same reason SeatRepository.lockForUpdate
// exists, and the same reason this function already needed a lock before
// reuse-detection existed: two concurrent presentations of the same token
// must be serialized, or both could read "not yet used" before either
// commits.
export async function rotateRefreshToken(rawToken: string): Promise<TokenPair> {
  const hash = hashToken(rawToken);

  const outcome = await prisma.$transaction(async (tx): Promise<RotationOutcome> => {
    const rows = await tx.$queryRaw<RefreshTokenRow[]>`
      SELECT id, "userId", "familyId", "usedAt", "revokedAt", "expiresAt"
      FROM "RefreshToken"
      WHERE "tokenHash" = ${hash}
      FOR UPDATE
    `;
    const existing = rows[0];

    if (!existing) {
      return { kind: "invalid" };
    }

    if (existing.usedAt !== null || existing.revokedAt !== null) {
      await tx.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { kind: "reused", userId: existing.userId, familyId: existing.familyId };
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      return { kind: "expired" };
    }

    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { usedAt: new Date() },
    });

    const user = await tx.user.findUniqueOrThrow({ where: { id: existing.userId } });
    const tokens = await issueTokenPair(user.id, user.role, tx, existing.familyId);
    return { kind: "rotated", tokens };
  });

  switch (outcome.kind) {
    case "invalid":
      throw new AuthTokenError("Invalid refresh token");
    case "reused":
      console.error(
        `Refresh token reuse detected for user ${outcome.userId} (family ${outcome.familyId}) -- entire token family revoked.`
      );
      throw new AuthTokenError("Refresh token has already been used");
    case "expired":
      throw new AuthTokenError("Refresh token has expired");
    case "rotated":
      return outcome.tokens;
  }
}

// Logout: marks the token used (if it's a real, still-valid one) so a
// stolen cookie can't be replayed after the user has logged out -- and if
// it ever is replayed, rotateRefreshToken's reuse-detection above takes it
// from there, since a used token being presented again is exactly what it
// watches for regardless of whether "used" means rotated or logged out. A
// missing/already-used/unknown token is not an error here -- logout should
// always succeed from the client's point of view.
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), usedAt: null },
    data: { usedAt: new Date() },
  });
}
