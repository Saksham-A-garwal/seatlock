import { EmailMessage } from "../auth/EmailSender";
import { bookingReference, generateBookingQrPng } from "./bookingQrCode";

interface BookingConfirmationDetails {
  bookingId: number;
  userEmail: string;
  movieName: string;
  venue: string;
  showtime: Date;
  seatLabels: string[];
  totalPrice: number;
}

const QR_CONTENT_ID = "booking-qr";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!
  );
}

export async function buildBookingConfirmationEmail(details: BookingConfirmationDetails): Promise<EmailMessage> {
  const reference = bookingReference(details.bookingId);
  const qrPng = await generateBookingQrPng(details.bookingId);
  const showtimeText = details.showtime.toLocaleString("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
  const seatsText = details.seatLabels.join(", ");
  const priceText = details.totalPrice.toFixed(2);

  const text = [
    "Your SeatLock booking is confirmed!",
    "",
    details.movieName,
    details.venue,
    showtimeText,
    "",
    `Seats: ${seatsText}`,
    `Total paid: Rs. ${priceText}`,
    `Booking reference: ${reference}`,
    "",
    "Show this email at the venue.",
  ].join("\n");

  // The QR is embedded inline via cid: (Resend attachment.contentId), not a
  // base64 data URI -- cid: references are the more broadly-supported way to
  // show an image inside an HTML email body.
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="color: #e63946; margin-bottom: 4px;">Booking confirmed</h2>
      <p style="margin: 0 0 16px;">
        <strong>${escapeHtml(details.movieName)}</strong><br/>
        ${escapeHtml(details.venue)}<br/>
        ${escapeHtml(showtimeText)}
      </p>
      <p style="margin: 0 0 16px;">
        Seats: <strong>${escapeHtml(seatsText)}</strong><br/>
        Total paid: <strong>Rs. ${priceText}</strong>
      </p>
      <p style="margin: 0 0 8px;">
        <img src="cid:${QR_CONTENT_ID}" alt="Booking QR code" width="180" height="180" />
      </p>
      <p style="color: #666; font-size: 13px; margin: 0;">
        Booking reference: ${reference}<br/>
        Show this QR code at the venue entrance.
      </p>
    </div>
  `;

  return {
    to: details.userEmail,
    subject: `Your tickets for ${details.movieName}`,
    text,
    html,
    attachments: [
      {
        filename: "seatlock-ticket-qr.png",
        content: qrPng,
        contentType: "image/png",
        contentId: QR_CONTENT_ID,
      },
    ],
  };
}
