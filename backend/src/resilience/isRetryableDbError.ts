import { Prisma } from "@prisma/client";

// Connection-establishment failures (server unreachable, timed out
// connecting, connection closed). Not a business outcome -- the query never
// even got to run.
const RETRYABLE_INIT_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);
// P2024: timed out waiting for a free connection from the pool.
const RETRYABLE_REQUEST_CODES = new Set(["P2024"]);

// Anything that ISN'T one of these specific Prisma connection-level error
// types returns false here -- including every one of our own thrown domain
// errors (SeatUnavailableError, SeatNotFoundError, ...), since those are
// never PrismaClientInitializationError/PrismaClientKnownRequestError
// instances in the first place. A 409 conflict can't accidentally get
// retried by this predicate; there's no code path where it would.
export function isRetryableDbError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode ? RETRYABLE_INIT_CODES.has(error.errorCode) : true;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_REQUEST_CODES.has(error.code);
  }
  return false;
}
