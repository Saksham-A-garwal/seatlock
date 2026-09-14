import { useEffect, useState } from "react";
import { ApiError, cancelBooking, getBookings, type BookingDto } from "../api/client";
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
      {bookings.map((booking) => (
        <div key={booking.id} className={styles.card}>
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
      ))}
    </div>
  );
}
