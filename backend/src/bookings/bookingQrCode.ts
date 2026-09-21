import crypto from "crypto";
import QRCode from "qrcode";
import { config } from "../config";

// The QR payload is just a stable, scannable reference to the booking --
// there's no separate check-in system on the other end of this yet, so it
// deliberately carries no secret or claim beyond "this booking exists".
// Deterministic from bookingId alone, so it never needs to be stored: the
// confirmation email and the on-demand ticket view both just regenerate the
// same PNG from the same id.
export function bookingReference(bookingId: number): string {
  return `SEATLOCK-BOOKING-${bookingId}`;
}

export function generateBookingQrPng(bookingId: number): Promise<Buffer> {
  return QRCode.toBuffer(bookingReference(bookingId), { width: 240, margin: 1 });
}

// Mail clients can't send an auth header when they fetch an email's images,
// so the emailed QR lives at a public URL guarded by an HMAC of the booking
// id instead. That stops anyone enumerating other bookings' QR images by id.
function qrToken(bookingId: number): string {
  return crypto.createHmac("sha256", config.jwtSecret).update(`booking-qr:${bookingId}`).digest("hex");
}

export function isValidQrToken(bookingId: number, token: string): boolean {
  const expected = Buffer.from(qrToken(bookingId));
  const actual = Buffer.from(token);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function publicQrImageUrl(bookingId: number): string {
  return `${config.apiPublicUrl}/bookings/${bookingId}/qr-image?token=${qrToken(bookingId)}`;
}
