import { describe, expect, it } from "vitest";
import { HoldNotValidError } from "../payments/errors";
import { isRetryableRazorpayError } from "./isRetryableRazorpayError";

describe("isRetryableRazorpayError", () => {
  it("treats our own domain errors as never retryable", () => {
    expect(isRetryableRazorpayError(new HoldNotValidError())).toBe(false);
  });

  it("treats a plain Error as never retryable", () => {
    expect(isRetryableRazorpayError(new Error("something else went wrong"))).toBe(false);
  });

  it("treats a Razorpay 500 as retryable", () => {
    expect(isRetryableRazorpayError({ statusCode: 500, error: { code: "SERVER_ERROR" } })).toBe(true);
  });

  it("treats a Razorpay 502 as retryable", () => {
    expect(isRetryableRazorpayError({ statusCode: "502", error: { code: "SERVER_ERROR" } })).toBe(true);
  });

  it("treats a Razorpay 400 bad request as not retryable", () => {
    expect(isRetryableRazorpayError({ statusCode: 400, error: { code: "BAD_REQUEST_ERROR" } })).toBe(false);
  });

  it("treats a Razorpay 401 unauthorized as not retryable", () => {
    expect(isRetryableRazorpayError({ statusCode: 401, error: { code: "UNAUTHORIZED" } })).toBe(false);
  });

  it("treats a connection-refused axios error as retryable", () => {
    expect(isRetryableRazorpayError({ isAxiosError: true, code: "ECONNREFUSED", response: undefined })).toBe(true);
  });

  it("treats a DNS-failure axios error as retryable", () => {
    expect(isRetryableRazorpayError({ isAxiosError: true, code: "ENOTFOUND", response: undefined })).toBe(true);
  });

  it("does not retry an axios error that already has a response", () => {
    expect(
      isRetryableRazorpayError({ isAxiosError: true, code: "ECONNREFUSED", response: { status: 400 } })
    ).toBe(false);
  });

  it("does not retry an axios error with an unrecognised code", () => {
    expect(isRetryableRazorpayError({ isAxiosError: true, code: "SOME_UNKNOWN_CODE", response: undefined })).toBe(
      false
    );
  });
});
