export type OtpErrorCode = "NO_ACTIVE_CODE" | "EXPIRED" | "ATTEMPTS_EXCEEDED" | "INCORRECT_CODE";

export class OtpError extends Error {
  readonly code: OtpErrorCode;

  constructor(code: OtpErrorCode, message: string) {
    super(message);
    this.name = "OtpError";
    this.code = code;
  }
}

export class AuthTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthTokenError";
  }
}
