import { useEffect, useRef, useState } from "react";
import { ApiError, cancelBooking, getBookingQrImageUrl, getBookings, type BookingDto } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { PageSpinner } from "../components/PageSpinner";
import styles from "./MyBookingsPage.module.css";

const ONE_HOUR_MS = 60 * 60 * 1000;

function canCancel(booking: BookingDto): boolean {
  if (booking.status !== "CONFIRMED") return false;
  return new Date(booking.show.showtime).getTime() - Date.now() > ONE_HOUR_MS;
}

export function MyBookingsPage() {
  const [bookings, setBookings] = useState<BookingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // At most one ticket shown at a time -- keeps this to a single in-flight
  // fetch, and one visible QR is all the "show it at the venue" use case
  // ever needs. Cached by bookingId so re-opening the same ticket is free.
  const [visibleQrId, setVisibleQrId] = useState<number | null>(null);
  const [qrLoadingId, setQrLoadingId] = useState<number | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrUrls, setQrUrls] = useState<Record<number, string>>({});
  // Mirrors qrUrls for the unmount-cleanup effect below, which needs the
  // latest cache without re-subscribing every time a new QR is fetched.
  const qrUrlsRef = useRef(qrUrls);
  useEffect(() => {
    qrUrlsRef.current = qrUrls;
  }, [qrUrls]);

  // Object URLs are per-tab memory, not garbage-collected automatically --
  // revoke every cached one when this page goes away.
  useEffect(() => {
    return () => {
      Object.values(qrUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  async function load() {
    try {
      const data = await getBookings();
      setBookings(data.bookings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your bookings.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCancel(bookingId: number) {
    setError(null);
    setCancellingId(bookingId);
    try {
      await cancelBooking(bookingId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel this booking.");
    } finally {
      setCancellingId(null);
    }
  }

  async function handleToggleTicket(bookingId: number) {
    if (visibleQrId === bookingId) {
      setVisibleQrId(null);
      return;
    }
    setQrError(null);
    setVisibleQrId(bookingId);
    if (qrUrls[bookingId]) return;

    setQrLoadingId(bookingId);
    try {
      const url = await getBookingQrImageUrl(bookingId);
      setQrUrls((prev) => ({ ...prev, [bookingId]: url }));
    } catch (err) {
      setQrError(err instanceof ApiError ? err.message : "Could not load your ticket.");
      setVisibleQrId(null);
    } finally {
      setQrLoadingId(null);
    }
  }

  if (error) {
    return <ErrorBanner message={error} />;
  }
  if (bookings === null) {
    return <PageSpinner />;
  }
  if (bookings.length === 0) {
    return <p className={styles.empty}>You haven't booked anything yet.</p>;
  }

  return (
    <div className={styles.list}>
      <h1>My Bookings</h1>
      {qrError && <ErrorBanner message={qrError} />}
      {bookings.map((booking) => (
        <div key={booking.id} className={styles.card}>
          <div className={styles.cardTop}>
            <div>
              <h3>{booking.show.movieName}</h3>
              <p className={styles.meta}>
                {booking.show.venue} · {new Date(booking.show.showtime).toLocaleString()}
              </p>
              <p className={styles.meta}>
                Seats: {booking.seats.map((seat) => `${seat.rowLabel}${seat.seatNumber}`).join(", ")} · ₹
                {booking.totalPrice.toFixed(2)}
              </p>
              <span className={`${styles.badge} ${styles[booking.status.toLowerCase()]}`}>{booking.status}</span>
            </div>
            <div className={styles.actions}>
              {booking.status === "CONFIRMED" && (
                <button
                  type="button"
                  className={styles.ticketButton}
                  disabled={qrLoadingId === booking.id}
                  onClick={() => void handleToggleTicket(booking.id)}
                >
                  {qrLoadingId === booking.id
                    ? "Loading…"
                    : visibleQrId === booking.id
                      ? "Hide ticket"
                      : "Show ticket"}
                </button>
              )}
              {canCancel(booking) && (
                <button
                  type="button"
                  className={styles.cancelButton}
                  disabled={cancellingId === booking.id}
                  onClick={() => void handleCancel(booking.id)}
                >
                  {cancellingId === booking.id ? "Cancelling…" : "Cancel"}
                </button>
              )}
            </div>
          </div>
          {visibleQrId === booking.id && qrUrls[booking.id] && (
            <div className={styles.qrSection}>
              <img src={qrUrls[booking.id]} alt="Booking QR ticket" className={styles.qrImage} />
              <p className={styles.qrHint}>Show this QR code at the venue entrance.</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
