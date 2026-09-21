import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { FakeEmailSender } from "../auth/FakeEmailSender";
import { buildOtpEmail } from "../auth/otpEmail";
import { buildBookingConfirmationEmail } from "./BookingConfirmationEmail";
import { isValidQrToken, publicQrImageUrl } from "./bookingQrCode";

describe("emailed QR image", () => {
  it("only validates the token that was issued for that exact booking", () => {
    const token = new URL(publicQrImageUrl(7)).searchParams.get("token")!;
    expect(isValidQrToken(7, token)).toBe(true);
    expect(isValidQrToken(8, token)).toBe(false);
    expect(isValidQrToken(7, "not-the-token")).toBe(false);
    expect(isValidQrToken(7, "")).toBe(false);
  });

  it("serves the PNG at the emailed URL with no login", async () => {
    const app = createApp({ emailSender: new FakeEmailSender() });
    const url = new URL(publicQrImageUrl(7));

    const res = await request(app).get(`${url.pathname}${url.search}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("returns 404 for a missing, wrong, or other-booking token", async () => {
    const app = createApp({ emailSender: new FakeEmailSender() });
    const otherToken = new URL(publicQrImageUrl(8)).searchParams.get("token")!;

    expect((await request(app).get("/bookings/7/qr-image")).status).toBe(404);
    expect((await request(app).get("/bookings/7/qr-image?token=nope")).status).toBe(404);
    expect((await request(app).get(`/bookings/7/qr-image?token=${otherToken}`)).status).toBe(404);
  });
});

describe("email templates", () => {
  it("escapes user-controlled text in the booking email", async () => {
    const message = await buildBookingConfirmationEmail({
      bookingId: 1,
      userEmail: "a@example.com",
      movieName: `<script>alert("x")</script>`,
      venue: "A & B Cinema",
      showtime: new Date("2026-09-23T13:00:00Z"),
      seatLabels: ["H5", "H6"],
      totalPrice: 700,
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("A &amp; B Cinema");
    expect(message.html).toContain("6:30 pm IST");
    expect(message.html).toContain("H5, H6");
  });

  it("keeps exactly one 6-digit number in the OTP text so the code is unambiguous", () => {
    const message = buildOtpEmail("a@example.com", "382507", 10);

    expect(message.text.match(/\b\d{6}\b/g)).toEqual(["382507"]);
    expect(message.html).toContain("382507");
    expect(message.subject).toBe("Your SeatLock sign-in code");
  });
});
