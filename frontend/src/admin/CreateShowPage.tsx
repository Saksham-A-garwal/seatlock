import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, createShow } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { Poster } from "../components/Poster";
import styles from "./CreateShowPage.module.css";

export function CreateShowPage() {
  const navigate = useNavigate();
  const [movieName, setMovieName] = useState("");
  const [venue, setVenue] = useState("");
  const [showtime, setShowtime] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [rows, setRows] = useState(8);
  const [columns, setColumns] = useState(10);
  const [basePrice, setBasePrice] = useState(250);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      const result = await createShow({
        movieName,
        venue,
        showtime: new Date(showtime).toISOString(),
        rows,
        columns,
        basePrice,
        posterUrl: posterUrl.trim() || undefined,
      });
      setSuccessMessage(`Created "${result.show.movieName}" with ${result.seatsCreated} seats.`);
      setTimeout(() => navigate(`/shows/${result.show.id}`), 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the show.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.container}>
      <h1>Create a Show</h1>
      <p className={styles.subtitle}>Admin only — generates the full seat grid immediately.</p>

      <div className={styles.layout}>
        <form onSubmit={(e) => void handleSubmit(e)} className={styles.form}>
          {error && <ErrorBanner message={error} />}
          {successMessage && <p className={styles.success}>{successMessage}</p>}

          <label htmlFor="movieName">Movie name</label>
          <input id="movieName" required value={movieName} onChange={(e) => setMovieName(e.target.value)} />

          <label htmlFor="posterUrl">Poster image URL (optional)</label>
          <input
            id="posterUrl"
            type="url"
            placeholder="https://…"
            value={posterUrl}
            onChange={(e) => setPosterUrl(e.target.value)}
          />

          <label htmlFor="venue">Venue</label>
          <input id="venue" required value={venue} onChange={(e) => setVenue(e.target.value)} />

          <label htmlFor="showtime">Showtime</label>
          <input
            id="showtime"
            type="datetime-local"
            required
            value={showtime}
            onChange={(e) => setShowtime(e.target.value)}
          />

          <div className={styles.row}>
            <div>
              <label htmlFor="rows">Rows (max 26)</label>
              <input
                id="rows"
                type="number"
                min={1}
                max={26}
                required
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="columns">Columns (max 50)</label>
              <input
                id="columns"
                type="number"
                min={1}
                max={50}
                required
                value={columns}
                onChange={(e) => setColumns(Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="basePrice">Base price ($)</label>
              <input
                id="basePrice"
                type="number"
                min={0.01}
                step={0.01}
                required
                value={basePrice}
                onChange={(e) => setBasePrice(Number(e.target.value))}
              />
            </div>
          </div>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create Show"}
          </button>
        </form>

        <div className={styles.previewCard}>
          <span className={styles.previewLabel}>Card preview</span>
          <div className={styles.previewPoster}>
            <Poster src={posterUrl.trim() || null} title={movieName || "Untitled"} />
          </div>
          <p className={styles.previewTitle}>{movieName || "Movie title"}</p>
          <p className={styles.previewMeta}>{venue || "Venue"}</p>
        </div>
      </div>
    </div>
  );
}
