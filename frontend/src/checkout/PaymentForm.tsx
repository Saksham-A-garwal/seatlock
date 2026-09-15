import { useRef, useState } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { loadRazorpayCheckout, openRazorpayCheckout } from "./razorpay";
import styles from "./PaymentForm.module.css";

interface PaymentFormProps {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  onSucceeded: () => void;
  onDeclined: (message: string) => void;
  onCancelled: () => void;
}

export function PaymentForm({
  orderId,
  amount,
  currency,
  keyId,
  onSucceeded,
  onDeclined,
  onCancelled,
}: PaymentFormProps) {
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Razorpay's docs don't clearly guarantee ondismiss is mutually exclusive
  // with handler/payment.failed (the widget closing itself after a result
  // could plausibly also fire ondismiss). Tracking whether the payment
  // already resolved means a dismiss is only ever treated as a genuine
  // cancel -- never as a false trigger to release a seat that just got
  // paid for, or one that's mid-decline-retry.
  const hasResolvedRef = useRef(false);

  async function handlePay() {
    setError(null);
    setIsOpening(true);
    hasResolvedRef.current = false;
    try {
      await loadRazorpayCheckout();
      const checkout = openRazorpayCheckout({
        key: keyId,
        order_id: orderId,
        amount: Math.round(amount * 100),
        currency,
        name: "SeatLock",
        description: "Seat booking",
        theme: { color: "#e11d2e" },
        // Razorpay's own client-side callback is not authoritative -- same
        // "never trust the client" rule the old Stripe flow followed. The
        // booking is only ever confirmed once the signed webhook lands;
        // this just starts polling for that.
        handler: () => {
          hasResolvedRef.current = true;
          onSucceeded();
        },
        modal: {
          ondismiss: () => {
            setIsOpening(false);
            if (!hasResolvedRef.current) {
              onCancelled();
            }
          },
        },
      });
      checkout.on("payment.failed", (response) => {
        hasResolvedRef.current = true;
        onDeclined(response.error.description || "Payment failed. Please try again.");
      });
      checkout.open();
    } catch {
      setIsOpening(false);
      setError("Could not open the payment window. Please try again.");
    }
  }

  return (
    <div className={styles.form}>
      {error && <ErrorBanner message={error} />}
      <p className={styles.hint}>Cards, UPI, netbanking and wallets are all available in the payment window.</p>
      <button type="button" className={styles.payButton} disabled={isOpening} onClick={() => void handlePay()}>
        {isOpening ? "Opening payment window…" : "Pay Now"}
      </button>
    </div>
  );
}
