import { useState, type FormEvent } from "react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { ApiError, requestOtp } from "../api/client";
import { BrandMark } from "../components/BrandMark";
import { ErrorBanner } from "../components/ErrorBanner";
import styles from "./SignInPage.module.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

type Step = "enterEmail" | "enterCode";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
}

export function SignInPage() {
  const { signInWithOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? "/";

  const [step, setStep] = useState<Step>("enterEmail");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await requestOtp(email);
      setStep("enterCode");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await signInWithOtp(email, code);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <BrandMark size={32} />
        </div>
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.subtitle}>Sign in to hold seats and manage your bookings.</p>

        <a className={styles.googleButton} href={`${API_BASE_URL}/auth/google`}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.93v2.33A9 9 0 0 0 9 18Z"
            />
            <path
              fill="#FBBC05"
              d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.93A9 9 0 0 0 0 9c0 1.45.35 2.83.93 4.03l3.02-2.33Z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .93 4.97l3.02 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
            />
          </svg>
          Continue with Google
        </a>

        <div className={styles.divider}>
          <span>or</span>
        </div>

        {error && <ErrorBanner message={error} />}

        {step === "enterEmail" ? (
          <form onSubmit={(e) => void handleRequestCode(e)} className={styles.form}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleVerifyCode(e)} className={styles.form}>
            <p className={styles.hint}>Enter the 6-digit code sent to {email}</p>
            <label htmlFor="code">Code</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setStep("enterEmail");
                setCode("");
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
