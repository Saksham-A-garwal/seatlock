export class SeatNotFoundError extends Error {
  constructor() {
    super("One or more requested seats don't exist for this show");
    this.name = "SeatNotFoundError";
  }
}

export class ShowNotFoundError extends Error {
  constructor() {
    super("Show not found");
    this.name = "ShowNotFoundError";
  }
}
