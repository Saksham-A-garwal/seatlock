import { Router } from "express";
import { BookingStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { requireAdmin, requireAuth } from "../auth/middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { SeatRepository } from "../seats/SeatRepository";

const BOOKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.CANCELLED];

export function createAdminRouter(): Router {
  const router = Router();
  const seatRepository = new SeatRepository();

  router.use("/admin", requireAuth, requireAdmin);

  router.get(
    "/admin/stats",
    asyncHandler(async (_req, res) => {
      const [totalShows, totalUsers, bookingCounts, revenue] = await Promise.all([
        prisma.show.count(),
        prisma.user.count(),
        prisma.booking.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.booking.aggregate({ where: { status: BookingStatus.CONFIRMED }, _sum: { totalPrice: true } }),
      ]);

      const totalBookings = bookingCounts.reduce((sum, row) => sum + row._count._all, 0);
      const confirmedBookings =
        bookingCounts.find((row) => row.status === BookingStatus.CONFIRMED)?._count._all ?? 0;

      res.status(200).json({
        totalShows,
        totalUsers,
        totalBookings,
        confirmedBookings,
        totalRevenue: revenue._sum.totalPrice?.toNumber() ?? 0,
      });
    })
  );

  router.get(
    "/admin/shows",
    asyncHandler(async (_req, res) => {
      const shows = await prisma.show.findMany({ orderBy: { showtime: "desc" } });
      const now = new Date();

      const withStats = await Promise.all(
        shows.map(async (show) => {
          const [seats, revenue] = await Promise.all([
            seatRepository.findByShow(show.id),
            prisma.booking.aggregate({
              where: { showId: show.id, status: BookingStatus.CONFIRMED },
              _sum: { totalPrice: true },
            }),
          ]);

          return {
            id: show.id,
            movieName: show.movieName,
            venue: show.venue,
            showtime: show.showtime,
            posterUrl: show.posterUrl,
            totalSeats: seats.length,
            availableSeats: seats.filter((seat) => seat.isAvailable(now)).length,
            bookedSeats: seats.filter((seat) => seat.status === "BOOKED").length,
            revenue: revenue._sum.totalPrice?.toNumber() ?? 0,
          };
        })
      );

      res.status(200).json({ shows: withStats });
    })
  );

  router.get(
    "/admin/bookings",
    asyncHandler(async (req, res) => {
      const statusParam = req.query.status;
      const where =
        typeof statusParam === "string" && BOOKING_STATUSES.includes(statusParam as BookingStatus)
          ? { status: statusParam as BookingStatus }
          : {};

      const bookings = await prisma.booking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          user: true,
          show: true,
          bookingSeats: { include: { seat: true } },
        },
      });

      res.status(200).json({
        bookings: bookings.map((booking) => ({
          id: booking.id,
          status: booking.status,
          totalPrice: booking.totalPrice.toNumber(),
          createdAt: booking.createdAt,
          confirmedAt: booking.confirmedAt,
          cancelledAt: booking.cancelledAt,
          user: { id: booking.user.id, email: booking.user.email },
          show: {
            id: booking.show.id,
            movieName: booking.show.movieName,
            venue: booking.show.venue,
            showtime: booking.show.showtime,
          },
          seats: booking.bookingSeats.map((bookingSeat) => ({
            rowLabel: bookingSeat.seat.rowLabel,
            seatNumber: bookingSeat.seat.seatNumber,
          })),
        })),
      });
    })
  );

  return router;
}
