import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? "3000"),

  jwtSecret: requireEnv("JWT_SECRET"),
  accessTokenTtlMinutes: Number(process.env.JWT_ACCESS_TTL_MINUTES ?? "15"),
  refreshTokenTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? "7"),

  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? "10"),
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? "5"),

  holdTtlMinutes: Number(process.env.HOLD_TTL_MINUTES ?? "5"),
  holdSweepIntervalSeconds: Number(process.env.HOLD_SWEEP_INTERVAL_SECONDS ?? "30"),

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? "",
  },

  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",

  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
};
