export class SeatUnavailableError extends Error {
  constructor(seatId: number) {
    super(`Seat ${seatId} is not available to hold`);
    this.name = "SeatUnavailableError";
  }
}

export class InvalidBookingTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot transition booking from ${from} to ${to}`);
    this.name = "InvalidBookingTransitionError";
  }
}

export class CancellationWindowPassedError extends Error {
  constructor() {
    super("Booking can no longer be cancelled — showtime is less than 1 hour away");
    this.name = "CancellationWindowPassedError";
  }
}

export class InvalidPaymentTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot transition payment from ${from} to ${to}`);
    this.name = "InvalidPaymentTransitionError";
  }
}
