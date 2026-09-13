import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getShows, type ShowSummary } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { Poster } from "../components/Poster";
import styles from "./ShowListPage.module.css";

function formatShowtime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

export function ShowListPage() {
  const [shows, setShows] = useState<ShowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getShows()
      .then((data) => {
        if (!cancelled) setShows(data.shows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load shows.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>Book your next show</h1>
        <p className={styles.heroSubtitle}>Pick your seats, hold them, and pay securely in minutes.</p>
      </section>

      {error && <ErrorBanner message={error} />}

      {shows === null && !error && (
        <div className={styles.grid}>
          {[1, 2, 3, 4].map((key) => (
            <div key={key} className={styles.skeletonCard} aria-hidden="true" />
          ))}
        </div>
      )}

      {shows !== null && shows.length === 0 && <p className={styles.empty}>No shows available right now.</p>}

      {shows !== null && shows.length > 0 && (
        <div className={styles.grid}>
          {shows.map((show) => {
            const { date, time } = formatShowtime(show.showtime);
            const low = show.availableSeatCount <= 10;
            return (
              <Link to={`/shows/${show.id}`} key={show.id} className={styles.card}>
                <div className={styles.posterFrame}>
                  <Poster src={show.posterUrl} title={show.movieName} />
                  <span className={`${styles.seatsBadge} ${low ? styles.seatsBadgeLow : ""}`}>
                    {show.availableSeatCount} left
                  </span>
                </div>
                <div className={styles.cardBody}>
                  <h3 className={styles.movieName}>{show.movieName}</h3>
                  <p className={styles.venue}>{show.venue}</p>
                  <p className={styles.showtime}>
                    {date} · {time}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
