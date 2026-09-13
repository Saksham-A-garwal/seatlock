import { Role, SeatStatus, User } from "@prisma/client";
import { prisma } from "../db/prisma";

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}@example.com`;
}

export async function createTestShow(showtime: Date = new Date(Date.now() + 24 * 60 * 60 * 1000)) {
  return prisma.show.create({
    data: { movieName: "Test Movie", venue: "Test Venue", showtime, rows: 5, columns: 5 },
  });
}

export async function createTestSeat(
  showId: number,
  overrides: Partial<{ rowLabel: string; seatNumber: number; status: SeatStatus; price: number }> = {}
) {
  return prisma.seat.create({
    data: {
      showId,
      rowLabel: overrides.rowLabel ?? "A",
      seatNumber: overrides.seatNumber ?? 1,
      status: overrides.status ?? SeatStatus.AVAILABLE,
      price: overrides.price ?? 250,
    },
  });
}

export async function createTestUser(role: Role = Role.USER): Promise<User> {
  return prisma.user.create({
    data: { email: unique("seat-test"), emailVerified: true, role },
  });
}

export async function cleanupShow(showId: number): Promise<void> {
  const seats = await prisma.seat.findMany({ where: { showId }, select: { id: true } });
  const seatIds = seats.map((s) => s.id);
  await prisma.bookingSeat.deleteMany({ where: { seatId: { in: seatIds } } });
  await prisma.booking.deleteMany({ where: { showId } });
  await prisma.seat.deleteMany({ where: { showId } });
  await prisma.show.delete({ where: { id: showId } });
}

export async function cleanupUsers(userIds: number[]): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
