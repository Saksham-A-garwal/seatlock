import { Router } from "express";
import { User } from "@prisma/client";
import { asyncHandler } from "../utils/asyncHandler";
import { AuthTokenError, OtpError } from "./errors";
import { OtpService } from "./otp";
import passport from "./passport";
import { issueTokenPair, rotateRefreshToken } from "./tokens";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublicUser(user: User) {
  return { id: user.id, email: user.email, role: user.role };
}

// otpService is injected rather than constructed here so tests can pass a
// fake EmailSender instead of hitting Resend for real on every run.
export function createAuthRouter(otpService: OtpService): Router {
  const router = Router();

  router.post(
    "/otp/request",
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
    asyncHandler(async (req, res) => {
      const { email, code } = req.body as { email?: string; code?: string };
      if (!email || !code) {
        res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Email and code are required" } });
        return;
      }

      try {
        const user = await otpService.verifyCode(email, code);
        const tokens = await issueTokenPair(user.id, user.role);
        res.status(200).json({ ...tokens, user: toPublicUser(user) });
      } catch (error) {
        if (error instanceof OtpError) {
          res.status(400).json({ error: { code: error.code, message: error.message } });
          return;
        }
        throw error;
      }
    })
  );

  router.get("/google", passport.authenticate("google", { scope: ["profile", "email"], session: false }));

  router.get(
    "/google/callback",
    passport.authenticate("google", { session: false }),
    asyncHandler(async (req, res) => {
      const user = req.user as User;
      const tokens = await issueTokenPair(user.id, user.role);
      res.status(200).json({ ...tokens, user: toPublicUser(user) });
    })
  );

  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (!refreshToken) {
        res.status(400).json({ error: { code: "INVALID_REQUEST", message: "refreshToken is required" } });
        return;
      }

      try {
        const tokens = await rotateRefreshToken(refreshToken);
        res.status(200).json(tokens);
      } catch (error) {
        if (error instanceof AuthTokenError) {
          res.status(401).json({ error: { code: "UNAUTHORIZED", message: error.message } });
          return;
        }
        throw error;
      }
    })
  );

  return router;
}
