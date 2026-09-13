import { Router } from "express";
import { prisma } from "../db/prisma";
import { requireAuth } from "../auth/middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { SeatUnavailableError } from "../domain/errors";
import { config } from "../config";
import { HoldService } from "./HoldService";
import { SeatRepository } from "./SeatRepository";
import { SeatNotFoundError } from "./errors";

function parsePositiveInt(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function createSeatsRouter(): Router {
  const router = Router();
  const seatRepository = new SeatRepository();
  const holdService = new HoldService(seatRepository);

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
