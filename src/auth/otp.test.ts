import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { OtpService } from "./otp";
import { FakeEmailSender } from "./FakeEmailSender";

function uniqueEmail(): string {
  return `otp-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe("OtpService", () => {
  let emailSender: FakeEmailSender;
  let otpService: OtpService;
  const createdEmails: string[] = [];

  beforeEach(() => {
    emailSender = new FakeEmailSender();
    otpService = new OtpService(emailSender);
  });

  afterEach(async () => {
    await prisma.otpCode.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: createdEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    createdEmails.length = 0;
  });

  it("sends a code and allows verifying it, creating the user on first use", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    await otpService.requestCode(email);
    const code = emailSender.lastCodeFor(email);
    const user = await otpService.verifyCode(email, code);

    expect(user.email).toBe(email);
    expect(user.emailVerified).toBe(true);
  });

  it("rejects an incorrect code without consuming it, and the real code still works after", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    await otpService.requestCode(email);

    await expect(otpService.verifyCode(email, "000000")).rejects.toMatchObject({
      code: "INCORRECT_CODE",
    });

    const code = emailSender.lastCodeFor(email);
    const user = await otpService.verifyCode(email, code);
    expect(user.email).toBe(email);
  });

  it("rejects verification once the attempt cap is exceeded", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    await otpService.requestCode(email);

    for (let i = 0; i < config.otpMaxAttempts; i++) {
      await expect(otpService.verifyCode(email, "000000")).rejects.toThrow();
    }

    const code = emailSender.lastCodeFor(email);
    await expect(otpService.verifyCode(email, code)).rejects.toMatchObject({
      code: "ATTEMPTS_EXCEEDED",
    });
  });

  it("rejects an expired code", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    await otpService.requestCode(email);
    const code = emailSender.lastCodeFor(email);

    await prisma.otpCode.updateMany({
      where: { email },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(otpService.verifyCode(email, code)).rejects.toMatchObject({
      code: "EXPIRED",
    });
  });

  it("rejects verification when no code was ever requested", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    await expect(otpService.verifyCode(email, "123456")).rejects.toMatchObject({
      code: "NO_ACTIVE_CODE",
    });
  });

  it("does not accept a code that was already consumed", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    await otpService.requestCode(email);
    const code = emailSender.lastCodeFor(email);
    await otpService.verifyCode(email, code);

    await expect(otpService.verifyCode(email, code)).rejects.toMatchObject({
      code: "NO_ACTIVE_CODE",
    });
  });
});
