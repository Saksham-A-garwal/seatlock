import { BookingStatus } from "@prisma/client";
import { CancellationWindowPassedError, InvalidBookingTransitionError } from "./errors";

interface BookingData {
  id: number;
  userId: number;
  showId: number;
  seatIds: number[];
  totalPrice: number;
  status?: BookingStatus;
  confirmedAt?: Date | null;
  cancelledAt?: Date | null;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export class Booking {
  readonly id: number;
  readonly userId: number;
  readonly showId: number;
  readonly seatIds: number[];
  readonly totalPrice: number;
  status: BookingStatus;
  confirmedAt: Date | null;
  cancelledAt: Date | null;

  constructor(data: BookingData) {
    this.id = data.id;
    this.userId = data.userId;
    this.showId = data.showId;
    this.seatIds = data.seatIds;
    this.totalPrice = data.totalPrice;
    this.status = data.status ?? BookingStatus.PENDING;
    this.confirmedAt = data.confirmedAt ?? null;
    this.cancelledAt = data.cancelledAt ?? null;
  }

  // FR-4a: a booking only ever reaches CONFIRMED via a verified webhook.
  confirm(now: Date = new Date()): void {
    if (this.status !== BookingStatus.PENDING) {
      throw new InvalidBookingTransitionError(this.status, BookingStatus.CONFIRMED);
    }
    this.status = BookingStatus.CONFIRMED;
    this.confirmedAt = now;
  }

  // FR-7: cancellation is only allowed up to 1 hour before showtime.
  cancel(showtime: Date, now: Date = new Date()): void {
    if (this.status !== BookingStatus.CONFIRMED) {
      throw new InvalidBookingTransitionError(this.status, BookingStatus.CANCELLED);
    }
    const cutoff = new Date(showtime.getTime() - ONE_HOUR_MS);
    if (now.getTime() > cutoff.getTime()) {
      throw new CancellationWindowPassedError();
    }
    this.status = BookingStatus.CANCELLED;
    this.cancelledAt = now;
  }
}
