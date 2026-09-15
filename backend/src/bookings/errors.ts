export class BookingNotFoundError extends Error {
  constructor() {
    super("Booking not found");
    this.name = "BookingNotFoundError";
  }
}

export class BookingNotConfirmedError extends Error {
  constructor() {
    super("A QR ticket is only available for a confirmed booking");
    this.name = "BookingNotConfirmedError";
  }
}
