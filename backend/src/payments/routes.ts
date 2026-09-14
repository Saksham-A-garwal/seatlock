import express, { Router } from "express";
import Razorpay from "razorpay";
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

// The shape of the body Razorpay POSTs to a configured webhook URL. Only the
// fields this app actually reads -- see docs.razorpay.com/webhooks/payloads/payments.
interface RazorpayWebhookBody {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id: string;
        order_id: string;
      };
    };
  };
}

// Mounted BEFORE the app's global express.json(): Razorpay's signature
// check needs the exact original request bytes, which express.json() would
// otherwise have already parsed away.
export function createPaymentsWebhookRouter(paymentService: PaymentService): Router {
  const router = Router();

  router.post(
    "/payments/webhook",
    express.raw({ type: "application/json" }),
    asyncHandler(async (req, res) => {
      // Logged unconditionally, before any validation: if this line never
      // shows up in the server's own console for a payment you just made,
      // the request never reached this process at all -- the problem is
      // upstream (ngrok/tunnel down, or the wrong URL saved in the Razorpay
      // Dashboard), not this handler's logic.
      console.log(`[webhook] POST /payments/webhook received, event id ${req.headers["x-razorpay-event-id"]}`);

      const signature = req.headers["x-razorpay-signature"];
      const eventId = req.headers["x-razorpay-event-id"];
      if (typeof signature !== "string" || typeof eventId !== "string") {
        console.warn("[webhook] rejected: missing X-Razorpay-Signature or X-Razorpay-Event-Id header");
        res.status(400).json({
          error: { code: "MISSING_SIGNATURE", message: "Missing X-Razorpay-Signature or X-Razorpay-Event-Id header" },
        });
        return;
      }

      const rawBody = (req.body as Buffer).toString("utf8");
      let signatureValid: boolean;
      try {
        signatureValid = Razorpay.validateWebhookSignature(rawBody, signature, config.razorpay.webhookSecret);
      } catch {
        signatureValid = false;
      }
      if (!signatureValid) {
        console.warn("[webhook] rejected: signature did not verify against RAZORPAY_WEBHOOK_SECRET");
        res
          .status(400)
          .json({ error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed" } });
        return;
      }

      let body: RazorpayWebhookBody;
      try {
        body = JSON.parse(rawBody) as RazorpayWebhookBody;
      } catch {
        res.status(400).json({ error: { code: "INVALID_BODY", message: "Malformed webhook payload" } });
        return;
      }

      try {
        // Insert-if-not-exists on Razorpay's own per-delivery event ID --
        // this IS the idempotency mechanism. A duplicate delivery hits the
        // unique constraint and is acknowledged without reprocessing.
        await prisma.webhookEvent.create({ data: { id: eventId, type: body.event } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          res.status(200).json({ received: true });
          return;
        }
        throw error;
      }

      const paymentEntity = body.payload?.payment?.entity;
      console.log(`[webhook] verified, event=${body.event}, order=${paymentEntity?.order_id ?? "n/a"}`);
      if (paymentEntity) {
        if (body.event === "payment.captured") {
          await paymentService.confirmPayment(paymentEntity.order_id, paymentEntity.id);
        } else if (body.event === "payment.failed") {
          await paymentService.markPaymentFailed(paymentEntity.order_id, paymentEntity.id);
        }
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
  const createOrderLimit = {
    keyPrefix: "payment-intent",
    windowSeconds: 60,
    max: config.rateLimits.paymentIntentPerUserPerMinute,
  };

  router.post(
    "/payments/create-order",
    requireAuth,
    rateLimitByUser(rateLimiter, createOrderLimit),
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
        const result = await paymentService.createOrder(parsedShowId, seatIds as number[], req.auth!.id);
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
