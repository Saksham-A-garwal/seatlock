export class SeatNotFoundError extends Error {
  constructor() {
    super("One or more requested seats don't exist for this show");
    this.name = "SeatNotFoundError";
  }
}

export class InvalidShowInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidShowInputError";
  }
}
