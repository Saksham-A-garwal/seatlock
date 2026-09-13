import { useState, type FormEvent } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { ErrorBanner } from "../components/ErrorBanner";
import styles from "./PaymentForm.module.css";

interface PaymentFormProps {
  onSucceeded: () => void;
  onDeclined: (message: string) => void;
}

export function PaymentForm({ onSucceeded, onDeclined }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setValidationError(null);
    setIsSubmitting(true);

    // redirect: "if_required" keeps this in the SPA for card payments that
    // don't need a 3DS redirect step, instead of a full-page bounce.
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (result.error) {
      setIsSubmitting(false);
      if (result.error.type === "validation_error") {
        setValidationError(result.error.message ?? "Please check your card details.");
      } else {
        onDeclined(result.error.message ?? "Payment failed. Please try again.");
      }
      return;
    }

    if (result.paymentIntent.status === "succeeded") {
      onSucceeded();
      return;
    }

    // Any other intermediate status (e.g. still processing) -- treat as not
    // yet decided; let the user retry rather than guessing.
    setIsSubmitting(false);
    setValidationError("Payment is still processing. Please wait a moment and try again.");
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className={styles.form}>
      <PaymentElement />
      {validationError && <ErrorBanner message={validationError} />}
      <button type="submit" disabled={!stripe || isSubmitting} className={styles.payButton}>
        {isSubmitting ? "Processing…" : "Pay Now"}
      </button>
    </form>
  );
}
