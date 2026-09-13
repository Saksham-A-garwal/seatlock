import express, { Express } from "express";
import { Pool } from "pg";
import { createAuthRouter } from "./auth/routes";
import { OtpService } from "./auth/otp";
import { ResendEmailSender } from "./auth/ResendEmailSender";
import { EmailSender } from "./auth/EmailSender";
import passport from "./auth/passport";
import { errorHandler } from "./middleware/errorHandler";

interface CreateAppOptions {
  emailSender?: EmailSender;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.use(express.json());
  app.use(passport.initialize());

  // Milestone 0 only: raw pg connection to prove DB connectivity before any
  // models existed. Kept as-is; real DB access elsewhere goes through Prisma.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.status(200).json({ status: "ok", db: "connected" });
    } catch (error) {
      console.error("Health check DB query failed:", error);
      res.status(500).json({ status: "error", db: "unreachable" });
    }
  });

  const emailSender = options.emailSender ?? new ResendEmailSender();
  const otpService = new OtpService(emailSender);
  app.use("/auth", createAuthRouter(otpService));

  app.use(errorHandler);

  return app;
}
