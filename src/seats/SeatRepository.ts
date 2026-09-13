import { Prisma, SeatStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { Seat } from "../domain/Seat";

interface SeatRow {
  id: number;
  showId: number;
  rowLabel: string;
  seatNumber: number;
  status: SeatStatus;
  heldById: number | null;
  holdExpiresAt: Date | null;
  price: unknown; // string, number, or Prisma.Decimal depending on query path
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  return Number(String(value));
}

function toSeat(row: SeatRow): Seat {
  return new Seat({
    id: row.id,
    showId: row.showId,
    rowLabel: row.rowLabel,
    seatNumber: row.seatNumber,
    status: row.status,
    heldById: row.heldById,
    holdExpiresAt: row.holdExpiresAt,
    price: toNumber(row.price),
  });
}

export class SeatRepository {
  // Locks the requested seat rows within an already-open transaction.
  // ORDER BY id is what keeps this deadlock-free: every concurrent caller
  // acquires row locks in the same ascending order, so two requests holding
  // overlapping seats in different orders can never form a wait-cycle.
  async lockForUpdate(tx: Prisma.TransactionClient, showId: number, seatIds: number[]): Promise<Seat[]> {
    const rows = await tx.$queryRaw<SeatRow[]>`
      SELECT id, "showId", "rowLabel", "seatNumber", status, "heldById", "holdExpiresAt", price
      FROM "Seat"
      WHERE "showId" = ${showId} AND id IN (${Prisma.join(seatIds)})
      ORDER BY id
      FOR UPDATE
    `;
    return rows.map(toSeat);
  }

  async persistHold(
    tx: Prisma.TransactionClient,
    seatIds: number[],
    userId: number,
    holdExpiresAt: Date
  ): Promise<void> {
    await tx.seat.updateMany({
      where: { id: { in: seatIds } },
      data: { status: SeatStatus.HELD, heldById: userId, holdExpiresAt },
    });
  }

  async findByShow(showId: number): Promise<Seat[]> {
    const rows = await prisma.seat.findMany({
      where: { showId },
      orderBy: [{ rowLabel: "asc" }, { seatNumber: "asc" }],
    });
    return rows.map((row) => toSeat({ ...row, price: row.price }));
  }

  // Bulk-resets rows whose hold has expired. Safe to run concurrently with
  // an in-flight hold transaction: Postgres's own row locking means this
  // UPDATE simply blocks on (and then re-evaluates) any row a hold
  // transaction currently has locked, so it can never clobber a fresh hold.
  async sweepExpiredHolds(now: Date = new Date()): Promise<number> {
    const result = await prisma.seat.updateMany({
      where: { status: SeatStatus.HELD, holdExpiresAt: { lt: now } },
      data: { status: SeatStatus.AVAILABLE, heldById: null, holdExpiresAt: null },
    });
    return result.count;
  }
}
