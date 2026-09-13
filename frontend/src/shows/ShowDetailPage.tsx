import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError, getSeatMap, holdSeats, type SeatDto, type ShowDetail } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { PageSpinner } from "../components/PageSpinner";
import { Poster } from "../components/Poster";
import { SeatGrid } from "./SeatGrid";
import styles from "./ShowDetailPage.module.css";

export function ShowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const showId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectMessage = (location.state as { message?: string } | null)?.message ?? null;

  const [show, setShow] = useState<ShowDetail | null>(null);
  const [seats, setSeats] = useState<SeatDto[] | null>(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState<Set<number>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(redirectMessage);
  const [isHolding, setIsHolding] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getSeatMap(showId);
      setShow(data.show);
      setSeats(data.seats);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not load this show.");
    }
  }, [showId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleSeat(seat: SeatDto) {
    setActionError(null);
    setSelectedSeatIds((prev) => {
      const next = new Set(prev);
      if (next.has(seat.id)) {
        next.delete(seat.id);
      } else {
        next.add(seat.id);
      }
      return next;
    });
  }

  async function handleProceed() {
    if (!user) {
      navigate("/sign-in", { state: { from: { pathname: `/shows/${showId}` } } });
      return;
    }

    setActionError(null);
    setIsHolding(true);
    try {
      const result = await holdSeats(showId, [...selectedSeatIds]);
      navigate(`/shows/${showId}/checkout`, {
        state: { seats: result.seats, holdExpiresAt: result.holdExpiresAt },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "SEAT_UNAVAILABLE") {
        setActionError("That seat was just taken. Please choose another.");
        setSelectedSeatIds(new Set());
        await load();
      } else {
        setActionError(err instanceof ApiError ? err.message : "Could not hold your seats. Please try again.");
      }
    } finally {
      setIsHolding(false);
    }
  }

  if (loadError) {
    return <ErrorBanner message={loadError} />;
  }
  if (!show || !seats) {
    return <PageSpinner />;
  }

  const selectedSeats = seats.filter((seat) => selectedSeatIds.has(seat.id));
  const total = selectedSeats.reduce((sum, seat) => sum + seat.price, 0);

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <div className={styles.posterFrame}>
          <Poster src={show.posterUrl} title={show.movieName} />
        </div>
        <div className={styles.heroInfo}>
          <h1>{show.movieName}</h1>
          <p className={styles.meta}>{show.venue}</p>
          <p className={styles.meta}>
            {new Date(show.showtime).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}{" "}
            · {new Date(show.showtime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} />}

      <div className={styles.seatSection}>
        <div className={styles.screenIndicator}>
          <div className={styles.screenBar} />
          <span>All eyes this way</span>
        </div>

        <SeatGrid seats={seats} selectedSeatIds={selectedSeatIds} onToggle={toggleSeat} disabled={isHolding} />
      </div>

      <div className={styles.summaryBar}>
        <div>
          <strong>{selectedSeats.length}</strong> seat{selectedSeats.length === 1 ? "" : "s"} selected
          {selectedSeats.length > 0 && <span className={styles.total}> · ${total.toFixed(2)}</span>}
        </div>
        <button
          type="button"
          className={styles.proceedButton}
          disabled={selectedSeats.length === 0 || isHolding}
          onClick={() => void handleProceed()}
        >
          {isHolding ? "Holding…" : "Proceed"}
        </button>
      </div>
    </div>
  );
}
