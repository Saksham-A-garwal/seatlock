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
  nodeEnv: process.env.NODE_ENV ?? "development",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",

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

  upstash: {
    restUrl: process.env.UPSTASH_REDIS_REST_URL ?? "",
    restToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
  },

  resilience: {
    maxAttempts: Number(process.env.RESILIENCE_MAX_ATTEMPTS ?? "3"),
    baseDelayMs: Number(process.env.RESILIENCE_BASE_DELAY_MS ?? "200"),
    timeoutMs: Number(process.env.RESILIENCE_TIMEOUT_MS ?? "5000"),
  },

  rateLimits: {
    authIpPerMinute: Number(process.env.RATE_LIMIT_AUTH_IP_PER_MINUTE ?? "5"),
    otpEmailPerMinute: Number(process.env.RATE_LIMIT_OTP_EMAIL_PER_MINUTE ?? "3"),
    holdPerUserPerMinute: Number(process.env.RATE_LIMIT_HOLD_PER_USER_PER_MINUTE ?? "10"),
    paymentIntentPerUserPerMinute: Number(process.env.RATE_LIMIT_PAYMENT_INTENT_PER_USER_PER_MINUTE ?? "5"),
  },
};
