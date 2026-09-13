import { Router } from "express";
import { prisma } from "../db/prisma";
import { requireAdmin, requireAuth } from "../auth/middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { SeatUnavailableError } from "../domain/errors";
import { config } from "../config";
import { RateLimiter } from "../rateLimit/RateLimiter";
import { rateLimitByUser } from "../rateLimit/middleware";
import { redisClient } from "../rateLimit/redisClient";
import { parsePositiveInt } from "../utils/parsePositiveInt";
import { HoldService } from "./HoldService";
import { SeatRepository } from "./SeatRepository";
import { ShowService } from "./ShowService";
import { InvalidShowInputError, SeatNotFoundError } from "./errors";

export function createSeatsRouter(): Router {
  const router = Router();
  const seatRepository = new SeatRepository();
  const holdService = new HoldService(seatRepository);
  const showService = new ShowService();
  const rateLimiter = new RateLimiter(redisClient);
  const holdLimit = { keyPrefix: "hold", windowSeconds: 60, max: config.rateLimits.holdPerUserPerMinute };

  router.get(
    "/shows",
    asyncHandler(async (_req, res) => {
      const shows = await prisma.show.findMany({ orderBy: { showtime: "asc" } });
      const now = new Date();

      const withCounts = await Promise.all(
        shows.map(async (show) => {
          const seats = await seatRepository.findByShow(show.id);
          return {
            id: show.id,
            movieName: show.movieName,
            venue: show.venue,
            showtime: show.showtime,
            availableSeatCount: seats.filter((seat) => seat.isAvailable(now)).length,
          };
        })
      );

      res.status(200).json({ shows: withCounts });
    })
  );

  router.post(
    "/shows",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = req.body as {
        movieName?: unknown;
        venue?: unknown;
        showtime?: unknown;
        rows?: unknown;
        columns?: unknown;
        basePrice?: unknown;
      };

      if (
        typeof body.movieName !== "string" ||
        typeof body.venue !== "string" ||
        typeof body.showtime !== "string" ||
        typeof body.rows !== "number" ||
        typeof body.columns !== "number" ||
        typeof body.basePrice !== "number"
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "movieName, venue, showtime (string) and rows, columns, basePrice (number) are all required",
          },
        });
        return;
      }

      try {
        const { show, seatsCreated } = await showService.createShow({
          movieName: body.movieName,
          venue: body.venue,
          showtime: new Date(body.showtime),
          rows: body.rows,
          columns: body.columns,
          basePrice: body.basePrice,
        });
        res.status(201).json({
          show: {
            id: show.id,
            movieName: show.movieName,
            venue: show.venue,
            showtime: show.showtime,
            rows: show.rows,
            columns: show.columns,
          },
          seatsCreated,
        });
      } catch (error) {
        if (error instanceof InvalidShowInputError) {
          res.status(400).json({ error: { code: "INVALID_SHOW_INPUT", message: error.message } });
          return;
        }
        throw error;
      }
    })
  );

  router.get(
    "/shows/:id/seats",
    asyncHandler(async (req, res) => {
      const showId = parsePositiveInt(req.params.id);
      if (showId === null) {
        res.status(400).json({ error: { code: "INVALID_SHOW_ID", message: "showId must be a positive integer" } });
        return;
      }

      const show = await prisma.show.findUnique({ where: { id: showId } });
      if (!show) {
        res.status(404).json({ error: { code: "SHOW_NOT_FOUND", message: "Show not found" } });
        return;
      }

      const seats = await seatRepository.findByShow(showId);
      const now = new Date();

      res.status(200).json({
        seats: seats.map((seat) => ({
          id: seat.id,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber,
          // Reports an expired-but-still-HELD row as AVAILABLE, same as the
          // hold check itself (FR-5) — the seat map never lies to a viewer
          // just because the sweep job hasn't run yet.
          status: seat.isAvailable(now) ? "AVAILABLE" : seat.status,
          price: seat.price,
        })),
      });
    })
  );

  router.post(
    "/shows/:id/hold",
    requireAuth,
    rateLimitByUser(rateLimiter, holdLimit),
    asyncHandler(async (req, res) => {
      const showId = parsePositiveInt(req.params.id);
      if (showId === null) {
        res.status(400).json({ error: { code: "INVALID_SHOW_ID", message: "showId must be a positive integer" } });
        return;
      }

      const { seatIds } = req.body as { seatIds?: unknown };
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
        const seats = await holdService.holdSeats(showId, seatIds as number[], req.auth!.id, config.holdTtlMinutes);
        res.status(200).json({
          seats: seats.map((seat) => ({ id: seat.id, status: seat.status })),
          holdExpiresAt: seats[0].holdExpiresAt,
        });
      } catch (error) {
        if (error instanceof SeatUnavailableError) {
          res.status(409).json({ error: { code: "SEAT_UNAVAILABLE", message: error.message } });
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

  return router;
}
