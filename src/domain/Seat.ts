import { SeatStatus } from "@prisma/client";
import { SeatUnavailableError } from "./errors";

interface SeatData {
  id: number;
  showId: number;
  rowLabel: string;
  seatNumber: number;
  status: SeatStatus;
  heldById: number | null;
  holdExpiresAt: Date | null;
  price: number;
}

export class Seat {
  readonly id: number;
  readonly showId: number;
  readonly rowLabel: string;
  readonly seatNumber: number;
  readonly price: number;
  status: SeatStatus;
  heldById: number | null;
  holdExpiresAt: Date | null;

  constructor(data: SeatData) {
    this.id = data.id;
    this.showId = data.showId;
    this.rowLabel = data.rowLabel;
    this.seatNumber = data.seatNumber;
    this.price = data.price;
    this.status = data.status;
    this.heldById = data.heldById;
    this.holdExpiresAt = data.holdExpiresAt;
  }

  // A seat counts as available if it's genuinely AVAILABLE, or if it's
  // HELD but that hold has already expired (FR-5: correctness can't
  // depend on the sweep job having run yet).
  isAvailable(now: Date = new Date()): boolean {
    if (this.status === SeatStatus.AVAILABLE) {
      return true;
    }
    if (this.status === SeatStatus.HELD) {
      return this.holdExpiresAt !== null && this.holdExpiresAt.getTime() < now.getTime();
    }
    return false;
  }

  holdFor(userId: number, ttlMinutes: number, now: Date = new Date()): void {
    if (!this.isAvailable(now)) {
      throw new SeatUnavailableError(this.id);
    }
    this.status = SeatStatus.HELD;
    this.heldById = userId;
    this.holdExpiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
  }

  release(): void {
    this.status = SeatStatus.AVAILABLE;
    this.heldById = null;
    this.holdExpiresAt = null;
  }

  book(): void {
    if (this.status !== SeatStatus.HELD) {
      throw new SeatUnavailableError(this.id);
    }
    this.status = SeatStatus.BOOKED;
    this.heldById = null;
    this.holdExpiresAt = null;
  }
}
