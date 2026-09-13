export class HoldNotValidError extends Error {
  constructor() {
    super("The requested seats are not currently held by you, or the hold has expired");
    this.name = "HoldNotValidError";
  }
}
