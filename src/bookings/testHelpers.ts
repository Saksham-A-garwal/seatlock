import { BookingStatus, SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";

interface CreateConfirmedBookingParams {
  showId: number;
  userId: number;
  seatIds: number[];
  totalPrice?: number;
  confirmedAt?: Date;
}

export async function createConfirmedBooking(params: CreateConfirmedBookingParams) {
  await prisma.seat.updateMany({
    where: { id: { in: params.seatIds } },
    data: { status: SeatStatus.BOOKED, heldById: null, holdExpiresAt: null },
  });

  return prisma.booking.create({
    data: {
      userId: params.userId,
      showId: params.showId,
      status: BookingStatus.CONFIRMED,
      totalPrice: params.totalPrice ?? 100,
      confirmedAt: params.confirmedAt ?? new Date(),
      bookingSeats: { create: params.seatIds.map((seatId) => ({ seatId })) },
    },
  });
}
