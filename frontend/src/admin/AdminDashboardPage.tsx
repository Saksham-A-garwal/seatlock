import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  getAdminBookings,
  getAdminShows,
  getAdminStats,
  type AdminBookingDto,
  type AdminShowSummary,
  type AdminStats,
} from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { PageSpinner } from "../components/PageSpinner";
import styles from "./AdminDashboardPage.module.css";

type Tab = "shows" | "bookings";
type StatusFilter = "ALL" | AdminBookingDto["status"];

function formatMoney(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [shows, setShows] = useState<AdminShowSummary[] | null>(null);
  const [bookings, setBookings] = useState<AdminBookingDto[] | null>(null);
  const [tab, setTab] = useState<Tab>("shows");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getAdminStats(), getAdminShows()])
      .then(([statsData, showsData]) => {
        setStats(statsData);
        setShows(showsData.shows);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the dashboard."));
  }, []);

  useEffect(() => {
    if (tab !== "bookings") return;
    setBookings(null);
    getAdminBookings(statusFilter === "ALL" ? undefined : statusFilter)
      .then((data) => setBookings(data.bookings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load bookings."));
  }, [tab, statusFilter]);

  if (error) {
    return <ErrorBanner message={error} />;
  }
  if (stats === null || shows === null) {
    return <PageSpinner />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <h1>Admin Dashboard</h1>
        <Link to="/admin/shows/new" className={styles.newShowLink}>
          + New Show
        </Link>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Shows</span>
          <span className={styles.statValue}>{stats.totalShows}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Users</span>
          <span className={styles.statValue}>{stats.totalUsers}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Confirmed Bookings</span>
          <span className={styles.statValue}>{stats.confirmedBookings}</span>
          <span className={styles.statSubtext}>{stats.totalBookings} total</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Revenue</span>
          <span className={styles.statValue}>{formatMoney(stats.totalRevenue)}</span>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={tab === "shows" ? styles.activeTab : styles.tab}
          onClick={() => setTab("shows")}
        >
          Shows
        </button>
        <button
          type="button"
          className={tab === "bookings" ? styles.activeTab : styles.tab}
          onClick={() => setTab("bookings")}
        >
          Bookings
        </button>
      </div>

      {tab === "shows" && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Movie</th>
                <th>Venue</th>
                <th>Showtime</th>
                <th>Seats booked</th>
                <th>Available</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {shows.map((show) => (
                <tr key={show.id}>
                  <td>
                    <Link to={`/shows/${show.id}`}>{show.movieName}</Link>
                  </td>
                  <td>{show.venue}</td>
                  <td>{new Date(show.showtime).toLocaleString()}</td>
                  <td>
                    {show.bookedSeats}/{show.totalSeats}
                  </td>
                  <td>{show.availableSeats}</td>
                  <td>{formatMoney(show.revenue)}</td>
                </tr>
              ))}
              {shows.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    No shows yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "bookings" && (
        <>
          <div className={styles.filterRow}>
            {(["ALL", "PENDING", "CONFIRMED", "CANCELLED"] as StatusFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                className={statusFilter === option ? styles.activeFilter : styles.filter}
                onClick={() => setStatusFilter(option)}
              >
                {option}
              </button>
            ))}
          </div>

          {bookings === null ? (
            <PageSpinner />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Booking</th>
                    <th>User</th>
                    <th>Movie</th>
                    <th>Seats</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => (
                    <tr key={booking.id}>
                      <td>#{booking.id}</td>
                      <td>{booking.user.email}</td>
                      <td>{booking.show.movieName}</td>
                      <td>{booking.seats.map((seat) => `${seat.rowLabel}${seat.seatNumber}`).join(", ")}</td>
                      <td>{formatMoney(booking.totalPrice)}</td>
                      <td>
                        <span className={`${styles.badge} ${styles[booking.status.toLowerCase()]}`}>
                          {booking.status}
                        </span>
                      </td>
                      <td>{new Date(booking.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {bookings.length === 0 && (
                    <tr>
                      <td colSpan={7} className={styles.empty}>
                        No bookings match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
