import { NextFunction, Request, Response } from "express";

// Last-resort handler: anything that reaches here wasn't turned into a
// specific response by the route/service itself. Per SRS section 7, every
// error response uses the same { error: { code, message } } shape and never
// leaks a stack trace or raw DB error to the client.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
  });
}
