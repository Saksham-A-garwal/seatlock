import QRCode from "qrcode";

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
