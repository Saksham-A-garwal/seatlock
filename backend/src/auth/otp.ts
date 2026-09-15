import crypto from "crypto";
import { User } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db/prisma";
import { EmailSender } from "./EmailSender";
import { OtpError } from "./errors";

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateCode(): string {
  return crypto.randomInt(100_000, 1_000_000).toString();
}

export class OtpService {
  constructor(private readonly emailSender: EmailSender) {}

  async requestCode(email: string): Promise<void> {
    const code = generateCode();
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60_000);

    await prisma.otpCode.create({
      data: { email, codeHash, expiresAt },
    });

    await this.emailSender.send({
      to: email,
      subject: "Your SeatLock sign-in code",
      text: `Your sign-in code is ${code}. It expires in ${config.otpTtlMinutes} minutes.`,
    });
  }

  // Returns the signed-in user on success; creates the account on first
  // successful verification (OTP verification IS the email-ownership proof,
  // there's no separate signup step).
  async verifyCode(email: string, code: string): Promise<User> {
    const otp = await prisma.otpCode.findFirst({
      where: { email, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) {
      throw new OtpError("NO_ACTIVE_CODE", "No active code for this email. Request a new one.");
    }
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new OtpError("EXPIRED", "Code expired. Request a new one.");
    }
    if (otp.attempts >= config.otpMaxAttempts) {
      throw new OtpError("ATTEMPTS_EXCEEDED", "Too many incorrect attempts. Request a new one.");
    }

    if (hashCode(code) !== otp.codeHash) {
      const updated = await prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      const attemptsLeft = config.otpMaxAttempts - updated.attempts;
      throw new OtpError("INCORRECT_CODE", `Incorrect code. ${attemptsLeft} attempt(s) left.`);
    }

    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    return prisma.user.upsert({
      where: { email },
      update: { emailVerified: true },
      create: { email, emailVerified: true },
    });
  }
}
