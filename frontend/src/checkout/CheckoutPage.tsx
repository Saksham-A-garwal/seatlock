import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError, createOrder, getPaymentStatus, releaseHold, type HeldSeat } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { PageSpinner } from "../components/PageSpinner";
import { PaymentForm } from "./PaymentForm";
import styles from "./CheckoutPage.module.css";

interface LocationState {
  seats: HeldSeat[];
  holdExpiresAt: string;
}

type Phase =
  | { name: "loadingIntent" }
  | { name: "paying"; orderId: string; paymentId: number; amount: number; currency: string; keyId: string }
  | { name: "confirming" }
  | { name: "confirmed"; bookingId: number }
  | { name: "declined"; message: string }
  | { name: "holdExpiredRace" }
  | { name: "confirmTimeout" }
  | { name: "error"; message: string };

function formatCountdown(seconds: number): string {
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mm}:${ss}`;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30_000;

export function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const showId = Number(id);
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState | null;

  const [phase, setPhase] = useState<Phase>({ name: "loadingIntent" });
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Read only from the unmount-release effect below, via a ref rather than
  // a dependency, specifically so that effect's cleanup runs ONLY on a true
  // unmount -- not on every phase change (which putting `phase` in that
  // effect's own deps would cause, incorrectly releasing the hold at the
  // exact moment a payment succeeds and the phase moves to "confirming").
  const phaseRef = useRef<Phase>(phase);
  // Guards against releasing twice: handleCancelled already releases before
  // navigating away, and that navigation then unmounts this page too --
  // without this, the unmount-release effect below would fire a second,
  // redundant releaseHold call right behind it.
  const hasReleasedRef = useRef(false);
  // Guards against StrictMode's dev-only double-invocation of mount effects
  // -- harmless for a GET, but this creates a real Razorpay order (and a
  // Payment row) each time, so it shouldn't fire twice.
  const hasStartedRef = useRef(false);

  const startPaymentIntent = useCallback(async () => {
    if (!state) return;
    setPhase({ name: "loadingIntent" });
    try {
      const result = await createOrder(
        showId,
        state.seats.map((seat) => seat.id)
      );
      setPhase({
        name: "paying",
        orderId: result.orderId,
        paymentId: result.paymentId,
        amount: result.amount,
        currency: result.currency,
        keyId: result.keyId,
      });
    } catch (err) {
      setPhase({
        name: "error",
        message: err instanceof ApiError ? err.message : "Could not start checkout. Please try again.",
      });
    }
  }, [state, showId]);

  // No hold info to work with (direct nav, or a page refresh lost the
  // in-memory navigation state) -- same honest treatment as an expired hold.
  useEffect(() => {
    if (!state) {
      navigate(`/shows/${showId}`, {
        replace: true,
        state: { message: "Your hold expired — please reselect." },
      });
      return;
    }
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    void startPaymentIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The hold countdown -- redirects back to reselect if it runs out before
  // the user has paid.
  useEffect(() => {
    if (!state) return;
    function tick() {
      const secondsLeft = Math.max(0, Math.round((new Date(state!.holdExpiresAt).getTime() - Date.now()) / 1000));
      setRemainingSeconds(secondsLeft);
      if (secondsLeft === 0 && (phase.name === "loadingIntent" || phase.name === "paying")) {
        navigate(`/shows/${showId}`, {
          replace: true,
          state: { message: "Your hold expired — please reselect." },
        });
      }
    }
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, phase.name, showId]);

  // Polls for the webhook to land once Razorpay's Checkout has reported
  // success client-side. Distinguishing a simple decline from the rare
  // hold-expired-and-refunded race doesn't need a backend flag: Razorpay
  // itself already told us the charge succeeded, so if our own backend
  // later reports FAILED, that combination IS the race case.
  function startConfirming(paymentId: number) {
    // Defensive: if this is somehow called again while a poll is already
    // running, clear the old interval first -- otherwise reassigning the
    // ref below would orphan it, leaking a second timer polling forever.
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPhase({ name: "confirming" });
    const startedAt = Date.now();

    pollTimerRef.current = setInterval(() => {
      void (async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setPhase({ name: "confirmTimeout" });
          return;
        }
        try {
          const status = await getPaymentStatus(paymentId);
          if (status.status === "SUCCEEDED" && status.bookingId) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setPhase({ name: "confirmed", bookingId: status.bookingId });
          } else if (status.status === "FAILED") {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setPhase({ name: "holdExpiredRace" });
          }
          // PENDING: keep polling.
        } catch {
          // A transient poll failure isn't fatal -- just try again next tick.
        }
      })();
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Covers the abandonment path handleCancelled doesn't: leaving this page
  // (back button, a nav link, closing the tab) without ever opening the
  // Razorpay widget at all. Without this, that hold just sits there until
  // its TTL expires naturally, instead of being freed immediately like a
  // dismissed widget already is.
  //
  // Only safe to fire from phases where nothing is actually in flight --
  // "confirming"/"confirmTimeout" mean a real payment may still land via
  // the webhook any moment; releasing the hold out from under that would
  // make confirmPayment think the hold didn't survive and wrongly refund a
  // payment that was actually about to succeed. "confirmed"/"holdExpiredRace"
  // are already resolved one way or the other -- nothing to release.
  //
  // The setTimeout deferral is required, not decorative: React StrictMode
  // (dev only) deliberately mounts every component twice -- effect, cleanup,
  // effect again, all synchronously in the same tick -- specifically to
  // surface bugs like this one. Without deferring, this cleanup fired on
  // that FAKE unmount while still "loadingIntent", releasing the seat out
  // from under the real createOrder call in flight and turning every
  // checkout in dev into an immediate 410. Deferring by a tick lets a
  // StrictMode remount (synchronous, same tick) flip mountedRef back to
  // true before the check runs, so only a genuine unmount reaches release.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      setTimeout(() => {
        if (mountedRef.current) return;
        const safeToRelease = (["loadingIntent", "paying", "declined", "error"] as Phase["name"][]).includes(
          phaseRef.current.name
        );
        if (safeToRelease && state && !hasReleasedRef.current) {
          hasReleasedRef.current = true;
          releaseHold(
            showId,
            state.seats.map((seat) => seat.id)
          ).catch(() => {
            // Best-effort, same reasoning as handleCancelled: the hold's own
            // TTL still reclaims the seat if this fails.
          });
        }
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fires when the user closes the payment widget without paying (not on a
  // decline -- that keeps the hold so they can retry with another card).
  // Releases the seats immediately rather than making them, and everyone
  // else, wait out the hold's TTL for a cancellation that already happened.
  function handleCancelled() {
    if (!state) return;
    hasReleasedRef.current = true;
    releaseHold(
      showId,
      state.seats.map((seat) => seat.id)
    ).catch(() => {
      // Best-effort: if this fails, the hold's own TTL still reclaims the
      // seat -- this is an optimization, not the only path to release.
    });
    navigate(`/shows/${showId}`, {
      replace: true,
      state: { message: "Checkout cancelled — your held seats were released." },
    });
  }

  if (!state) {
    return <PageSpinner />;
  }

  const total = state.seats.reduce((sum, seat) => sum + seat.price, 0);
  const seatLabels = state.seats.map((seat) => `${seat.rowLabel}${seat.seatNumber}`).join(", ");

  return (
    <div className={styles.container}>
      <h1>Checkout</h1>

      <div className={styles.summary}>
        <p>
          Seats: <strong>{seatLabels}</strong>
        </p>
        <p>
          Total: <strong>₹{total.toFixed(2)}</strong>
        </p>
        {(phase.name === "loadingIntent" || phase.name === "paying") && (
          <p className={styles.countdown}>Complete booking in {formatCountdown(remainingSeconds)}</p>
        )}
      </div>

      {phase.name === "loadingIntent" && <PageSpinner label="Preparing payment…" />}

      {phase.name === "paying" && (
        <PaymentForm
          orderId={phase.orderId}
          amount={phase.amount}
          currency={phase.currency}
          keyId={phase.keyId}
          onSucceeded={() => startConfirming(phase.paymentId)}
          onDeclined={(message) => setPhase({ name: "declined", message })}
          onCancelled={handleCancelled}
        />
      )}

      {phase.name === "confirming" && <PageSpinner label="Confirming your booking…" />}

      {phase.name === "confirmed" && (
        <div className={styles.confirmation}>
          <h2>Booking confirmed</h2>
          <p>Your seats are booked. Booking reference: #{phase.bookingId}</p>
          <Link to="/bookings">View My Bookings</Link>
        </div>
      )}

      {phase.name === "declined" && (
        <div className={styles.declined}>
          <ErrorBanner message={phase.message} />
          <p className={styles.retryHint}>Your seats are still held — you can try again below.</p>
          <button type="button" className={styles.retryButton} onClick={() => void startPaymentIntent()}>
            Try again
          </button>
        </div>
      )}

      {phase.name === "holdExpiredRace" && (
        <div className={styles.raceNotice}>
          <h2>Your seat was released</h2>
          <p>
            Your payment succeeded, but your hold expired a moment before we could confirm it — this seat has
            already been released back to other users. You have been automatically refunded; no charge will
            appear on your statement.
          </p>
          <Link to={`/shows/${showId}`}>Choose another seat</Link>
        </div>
      )}

      {phase.name === "confirmTimeout" && (
        <div className={styles.raceNotice}>
          <h2>Still confirming…</h2>
          <p>
            This is taking longer than expected. Your payment may still be processing — check My Bookings in a
            minute, or contact support if it doesn't show up.
          </p>
          <Link to="/bookings">Check My Bookings</Link>
        </div>
      )}

      {phase.name === "error" && <ErrorBanner message={phase.message} />}
    </div>
  );
}
