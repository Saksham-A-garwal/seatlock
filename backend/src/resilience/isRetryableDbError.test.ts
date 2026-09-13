import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { SeatUnavailableError } from "../domain/errors";
import { isRetryableDbError } from "./isRetryableDbError";

describe("isRetryableDbError", () => {
  it("treats our own domain errors as never retryable", () => {
    expect(isRetryableDbError(new SeatUnavailableError(1))).toBe(false);
  });

  it("treats a plain Error as never retryable", () => {
    expect(isRetryableDbError(new Error("something else went wrong"))).toBe(false);
  });

  it("treats a connection-pool-timeout Prisma error (P2024) as retryable", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Timed out fetching a connection", {
      code: "P2024",
      clientVersion: "5.22.0",
    });
    expect(isRetryableDbError(error)).toBe(true);
  });

  it("treats a unique-constraint Prisma error (P2002) as not retryable", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    expect(isRetryableDbError(error)).toBe(false);
  });

  it("treats a can't-reach-database Prisma init error (P1001) as retryable", () => {
    const error = new Prisma.PrismaClientInitializationError("Can't reach database server", "5.22.0", "P1001");
    expect(isRetryableDbError(error)).toBe(true);
  });
});
