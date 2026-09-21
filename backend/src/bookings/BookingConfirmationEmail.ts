import { config } from "../config";
import { EmailMessage } from "../auth/EmailSender";
import { EMAIL_COLORS, EMAIL_FONT, emailButton, escapeHtml, renderEmail } from "../email/layout";
import { bookingReference, generateBookingQrPng, publicQrImageUrl } from "./bookingQrCode";

interface BookingConfirmationDetails {
  bookingId: number;
  userEmail: string;
  movieName: string;
  venue: string;
  showtime: Date;
  seatLabels: string[];
  totalPrice: number;
}

function detailRow(label: string, value: string, isLast = false): string {
  const c = EMAIL_COLORS;
  const border = isLast ? "" : `border-bottom:1px solid ${c.border};`;
  return `
    <tr>
      <td style="padding:12px 0;${border}font-size:13px;color:${c.muted};width:110px;">${escapeHtml(label)}</td>
      <td style="padding:12px 0;${border}font-size:15px;font-weight:600;color:${c.ink};text-align:right;">${escapeHtml(value)}</td>
    </tr>`;
}

export async function buildBookingConfirmationEmail(details: BookingConfirmationDetails): Promise<EmailMessage> {
  const c = EMAIL_COLORS;
  const reference = bookingReference(details.bookingId);
  const qrPng = await generateBookingQrPng(details.bookingId);
  const dateText = details.showtime.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  const timeText = `${details.showtime.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  })} IST`;
  const seatsText = details.seatLabels.join(", ");
  const priceText = details.totalPrice.toFixed(2);
  const bookingsUrl = `${config.frontendOrigin}/bookings`;

  const text = [
    "Your SeatLock booking is confirmed!",
    "",
    details.movieName,
    details.venue,
    `${dateText}, ${timeText}`,
    "",
    `Seats: ${seatsText}`,
    `Total paid: Rs. ${priceText}`,
    `Booking reference: ${reference}`,
    "",
    "Show the QR code (attached to this email) at the venue entrance.",
    `View your booking any time: ${bookingsUrl}`,
  ].join("\n");

  const bodyHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <tr>
        <td style="background:${c.successBg};border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;letter-spacing:0.5px;color:${c.success};">&#10003;&nbsp; CONFIRMED</td>
      </tr>
    </table>
    <h1 style="margin:0 0 8px;font-size:26px;line-height:32px;font-weight:700;color:${c.ink};">${escapeHtml(details.movieName)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:${c.muted};">Your seats are booked. Show the QR code below at the venue entrance.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${c.border};">
      ${detailRow("Venue", details.venue)}
      ${detailRow("Date", dateText)}
      ${detailRow("Time", timeText)}
      ${detailRow("Seats", seatsText)}
      ${detailRow("Total paid", `₹${priceText}`, true)}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
      <tr>
        <td align="center" style="background:${c.surface};border:1px solid ${c.border};border-radius:12px;padding:24px 16px;">
          <img src="${escapeHtml(publicQrImageUrl(details.bookingId))}" alt="Booking QR code" width="180" height="180" style="display:block;margin:0 auto;border:0;border-radius:8px;background:#ffffff;">
          <div style="margin-top:14px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;letter-spacing:1px;color:${c.ink};">${escapeHtml(reference)}</div>
          <div style="margin-top:4px;font-family:${EMAIL_FONT};font-size:12px;color:${c.muted};">Booking reference</div>
        </td>
      </tr>
    </table>

    ${emailButton("View my bookings", bookingsUrl)}

    <p style="margin:24px 0 0;font-size:13px;line-height:20px;color:${c.muted};text-align:center;">
      The QR code is also attached to this email, so you can open it even without a connection at the venue.
    </p>`;

  return {
    to: details.userEmail,
    subject: `Your tickets for ${details.movieName}`,
    text,
    html: renderEmail({
      title: `Booking confirmed: ${details.movieName}`,
      preheader: `${details.movieName} · ${dateText} · Seats ${seatsText}`,
      bodyHtml,
    }),
    attachments: [
      {
        filename: "seatlock-ticket-qr.png",
        content: qrPng,
        contentType: "image/png",
      },
    ],
  };
}
