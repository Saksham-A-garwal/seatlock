import { useState } from "react";
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
}

export function PaymentForm({ orderId, amount, currency, keyId, onSucceeded, onDeclined }: PaymentFormProps) {
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setError(null);
    setIsOpening(true);
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
        handler: () => onSucceeded(),
        modal: {
          ondismiss: () => setIsOpening(false),
        },
      });
      checkout.on("payment.failed", (response) => {
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
