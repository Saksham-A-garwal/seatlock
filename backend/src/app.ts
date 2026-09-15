import express, { Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Pool } from "pg";
import { config } from "./config";
import { createAuthRouter } from "./auth/routes";
import { OtpService } from "./auth/otp";
import { ResendEmailSender } from "./auth/ResendEmailSender";
import { EmailSender } from "./auth/EmailSender";
import passport from "./auth/passport";
import { errorHandler } from "./middleware/errorHandler";
import { createSeatsRouter } from "./seats/routes";
import { SeatRepository } from "./seats/SeatRepository";
import { createPaymentsRouter, createPaymentsWebhookRouter } from "./payments/routes";
import { PaymentService } from "./payments/PaymentService";
import { createBookingsRouter } from "./bookings/routes";
import { createAdminRouter } from "./admin/routes";

interface CreateAppOptions {
  emailSender?: EmailSender;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  const emailSender = options.emailSender ?? new ResendEmailSender();
  const seatRepository = new SeatRepository();
  const paymentService = new PaymentService(seatRepository, undefined, emailSender);

  // Must be mounted BEFORE express.json(): Razorpay's webhook signature check
  // needs the raw, unparsed request body.
  app.use(createPaymentsWebhookRouter(paymentService));

  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
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

  const otpService = new OtpService(emailSender);
  app.use("/auth", createAuthRouter(otpService));
  app.use(createSeatsRouter());
  app.use(createPaymentsRouter(paymentService));
  app.use(createBookingsRouter());
  app.use(createAdminRouter());

  app.use(errorHandler);

  return app;
}
