import { useState } from "react";
import styles from "./SeatCountModal.module.css";

interface SeatCountModalProps {
  minSeats: number;
  maxSeats: number;
  pricePerSeat: number;
  availableCount: number;
  initialValue: number;
  onConfirm: (count: number) => void;
}

export function SeatCountModal({
  minSeats,
  maxSeats,
  pricePerSeat,
  availableCount,
  initialValue,
  onConfirm,
}: SeatCountModalProps) {
  const [count, setCount] = useState(initialValue);
  const options = Array.from({ length: maxSeats - minSeats + 1 }, (_, i) => minSeats + i);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Choose how many seats">
      <div className={styles.card}>
        <h2 className={styles.title}>How many seats?</h2>

        <div className={styles.options}>
          {options.map((n) => (
            <button
              key={n}
              type="button"
              className={n === count ? styles.optionActive : styles.option}
              aria-pressed={n === count}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>

        <div className={styles.summary}>
          <span>₹{pricePerSeat.toFixed(0)} per seat</span>
          <span className={styles.available}>{availableCount} seats available</span>
        </div>

        <button type="button" className={styles.confirmButton} onClick={() => onConfirm(count)}>
          Select Seats
        </button>
      </div>
    </div>
  );
}
