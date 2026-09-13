import { Response, Router } from "express";
import { User } from "@prisma/client";
import { asyncHandler } from "../utils/asyncHandler";
import { config } from "../config";
import { prisma } from "../db/prisma";
import { RateLimiter } from "../rateLimit/RateLimiter";
import { rateLimitByEmail, rateLimitByIp } from "../rateLimit/middleware";
import { redisClient } from "../rateLimit/redisClient";
import { AuthTokenError, OtpError } from "./errors";
import { requireAuth } from "./middleware";
import { OtpService } from "./otp";
import passport from "./passport";
import { issueTokenPair, revokeRefreshToken, rotateRefreshToken } from "./tokens";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFRESH_COOKIE_NAME = "refreshToken";
// Scoped to just this one path so the cookie is never attached to any other
// request -- it's useless to steal via XSS on any other endpoint, and the
// browser doesn't even send it anywhere else in the first place.
const REFRESH_COOKIE_PATH = "/auth/refresh";

function toPublicUser(user: User) {
  return { id: user.id, email: user.email, role: user.role };
}

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

// otpService is injected rather than constructed here so tests can pass a
// fake EmailSender instead of hitting Resend for real on every run.
export function createAuthRouter(otpService: OtpService): Router {
  const router = Router();
  const rateLimiter = new RateLimiter(redisClient);
  const authIpLimit = { keyPrefix: "auth", windowSeconds: 60, max: config.rateLimits.authIpPerMinute };
  const otpEmailLimit = { keyPrefix: "otp-request", windowSeconds: 60, max: config.rateLimits.otpEmailPerMinute };

  router.post(
    "/otp/request",
    rateLimitByIp(rateLimiter, authIpLimit),
    rateLimitByEmail(rateLimiter, otpEmailLimit),
    asyncHandler(async (req, res) => {
      const { email } = req.body as { email?: string };
      if (!email || !EMAIL_PATTERN.test(email)) {
        res.status(400).json({ error: { code: "INVALID_EMAIL", message: "A valid email is required" } });
        return;
      }

      await otpService.requestCode(email);
      res.status(200).json({ message: "Code sent" });
    })
  );

  router.post(
    "/otp/verify",
    rateLimitByIp(rateLimiter, authIpLimit),
    asyncHandler(async (req, res) => {
      const { email, code } = req.body as { email?: string; code?: string };
      if (!email || !code) {
        res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Email and code are required" } });
        return;
      }

      try {
        const user = await otpService.verifyCode(email, code);
        const tokens = await issueTokenPair(user.id, user.role);
        setRefreshCookie(res, tokens.refreshToken);
        res.status(200).json({ accessToken: tokens.accessToken, user: toPublicUser(user) });
      } catch (error) {
        if (error instanceof OtpError) {
          res.status(400).json({ error: { code: error.code, message: error.message } });
          return;
        }
        throw error;
      }
    })
  );

  router.get(
    "/google",
    rateLimitByIp(rateLimiter, authIpLimit),
    passport.authenticate("google", { scope: ["profile", "email"], session: false })
  );

  router.get(
    "/google/callback",
    rateLimitByIp(rateLimiter, authIpLimit),
    passport.authenticate("google", { session: false }),
    asyncHandler(async (req, res) => {
      const user = req.user as User;
      const tokens = await issueTokenPair(user.id, user.role);
      setRefreshCookie(res, tokens.refreshToken);
      // This is a full browser navigation (not an XHR call), so there's no
      // JSON response to return here -- hand control back to the SPA, which
      // bootstraps its in-memory access token via POST /auth/refresh (the
      // cookie set above is already there for it to use).
      res.redirect(`${config.frontendOrigin}/auth/callback`);
    })
  );

  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (!refreshToken) {
        res.status(401).json({ error: { code: "UNAUTHORIZED", message: "No refresh token cookie present" } });
        return;
      }

      try {
        const tokens = await rotateRefreshToken(refreshToken);
        setRefreshCookie(res, tokens.refreshToken);
        res.status(200).json({ accessToken: tokens.accessToken });
      } catch (error) {
        if (error instanceof AuthTokenError) {
          clearRefreshCookie(res);
          res.status(401).json({ error: { code: "UNAUTHORIZED", message: error.message } });
          return;
        }
        throw error;
      }
    })
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      if (refreshToken) {
        await revokeRefreshToken(refreshToken);
      }
      clearRefreshCookie(res);
      res.status(200).json({ message: "Logged out" });
    })
  );

  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      // Looked up fresh from the DB rather than trusting the JWT payload
      // as-is (it only carries id + role) -- also means a role change takes
      // effect immediately here, without waiting for the token to expire.
      const user = await prisma.user.findUnique({ where: { id: req.auth!.id } });
      if (!user) {
        res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
        return;
      }
      res.status(200).json(toPublicUser(user));
    })
  );

  return router;
}
