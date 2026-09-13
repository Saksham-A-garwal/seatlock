import express, { Router } from "express";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { config } from "../config";
import { prisma } from "../db/prisma";
import { RateLimiter } from "../rateLimit/RateLimiter";
import { rateLimitByUser } from "../rateLimit/middleware";
import { redisClient } from "../rateLimit/redisClient";
import { SeatNotFoundError } from "../seats/errors";
import { parsePositiveInt } from "../utils/parsePositiveInt";
import { HoldNotValidError } from "./errors";
import { PaymentService } from "./PaymentService";
import { stripeClient } from "./stripeClient";

// Mounted BEFORE the app's global express.json(): Stripe's signature check
// needs the exact original request bytes, which express.json() would
// otherwise have already parsed away.
export function createPaymentsWebhookRouter(paymentService: PaymentService): Router {
  const router = Router();

  router.post(
    "/payments/webhook",
    express.raw({ type: "application/json" }),
    asyncHandler(async (req, res) => {
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string") {
        res.status(400).json({ error: { code: "MISSING_SIGNATURE", message: "Missing Stripe-Signature header" } });
        return;
      }

      let event: Stripe.Event;
      try {
        event = stripeClient.webhooks.constructEvent(req.body as Buffer, signature, config.stripeWebhookSecret);
      } catch {
        res
          .status(400)
          .json({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
        return;
      }

      try {
        // Insert-if-not-exists on the Stripe event ID -- this IS the
        // idempotency mechanism. A duplicate delivery hits the unique
        // constraint and is acknowledged without reprocessing.
        await prisma.webhookEvent.create({ data: { id: event.id, type: event.type } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          res.status(200).json({ received: true });
          return;
        }
        throw error;
      }

      if (event.type === "payment_intent.succeeded") {
        const intent = event.data.object as Stripe.PaymentIntent;
        await paymentService.confirmPayment(intent.id);
      } else if (event.type === "payment_intent.payment_failed") {
        const intent = event.data.object as Stripe.PaymentIntent;
        await paymentService.markPaymentFailed(intent.id);
      }
      // Any other event type: acknowledged, not acted on.

      res.status(200).json({ received: true });
    })
  );

  return router;
}

// Mounted normally (after express.json()), alongside the rest of the app's
// JSON-body routes.
export function createPaymentsRouter(paymentService: PaymentService): Router {
  const router = Router();
  const rateLimiter = new RateLimiter(redisClient);
  const createIntentLimit = {
    keyPrefix: "payment-intent",
    windowSeconds: 60,
    max: config.rateLimits.paymentIntentPerUserPerMinute,
  };

  router.post(
    "/payments/create-intent",
    requireAuth,
    rateLimitByUser(rateLimiter, createIntentLimit),
    asyncHandler(async (req, res) => {
      const { showId, seatIds } = req.body as { showId?: unknown; seatIds?: unknown };

      const parsedShowId = typeof showId === "number" && Number.isInteger(showId) && showId > 0 ? showId : null;
      if (parsedShowId === null) {
        res.status(400).json({ error: { code: "INVALID_SHOW_ID", message: "showId must be a positive integer" } });
        return;
      }
      if (
        !Array.isArray(seatIds) ||
        seatIds.length === 0 ||
        !seatIds.every((id) => Number.isInteger(id) && id > 0)
      ) {
        res.status(400).json({
          error: { code: "INVALID_SEAT_IDS", message: "seatIds must be a non-empty array of positive integers" },
        });
        return;
      }

      try {
        const result = await paymentService.createPaymentIntent(parsedShowId, seatIds as number[], req.auth!.id);
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof HoldNotValidError) {
          res.status(410).json({ error: { code: "HOLD_NOT_VALID", message: error.message } });
          return;
        }
        if (error instanceof SeatNotFoundError) {
          res.status(404).json({ error: { code: "SEAT_NOT_FOUND", message: error.message } });
          return;
        }
        throw error;
      }
    })
  );

  router.get(
    "/payments/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const paymentId = parsePositiveInt(req.params.id);
      if (paymentId === null) {
        res
          .status(400)
          .json({ error: { code: "INVALID_PAYMENT_ID", message: "paymentId must be a positive integer" } });
        return;
      }

      const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
      // "Doesn't exist" and "exists but isn't yours" both come back as the
      // same not-found response -- same IDOR-safety reasoning as bookings.
      if (!payment || payment.userId !== req.auth!.id) {
        res.status(404).json({ error: { code: "PAYMENT_NOT_FOUND", message: "Payment not found" } });
        return;
      }

      res.status(200).json({ id: payment.id, status: payment.status, bookingId: payment.bookingId });
    })
  );

  return router;
}
