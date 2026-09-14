import type { SeatDto } from "../api/client";
import styles from "./SeatGrid.module.css";

interface SeatGridProps {
  seats: SeatDto[];
  selectedSeatIds: Set<number>;
  onToggle: (seat: SeatDto) => void;
  disabled?: boolean;
}

function describeStatus(seat: SeatDto, isSelected: boolean): string {
  if (isSelected) return "selected";
  if (seat.status === "BOOKED") return "booked";
  if (seat.status === "HELD") return "held by another user";
  return "available";
}

export function SeatGrid({ seats, selectedSeatIds, onToggle, disabled = false }: SeatGridProps) {
  const rowLabels = [...new Set(seats.map((seat) => seat.rowLabel))].sort();
  const seatsByRow = new Map<string, SeatDto[]>(
    rowLabels.map((label) => [
      label,
      seats.filter((seat) => seat.rowLabel === label).sort((a, b) => a.seatNumber - b.seatNumber),
    ])
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.scrollArea}>
        <div className={styles.grid}>
          {rowLabels.map((label) => (
            <div key={label} className={styles.row}>
              <span className={styles.rowLabel}>{label}</span>
              {(seatsByRow.get(label) ?? []).map((seat) => {
                const isSelected = selectedSeatIds.has(seat.id);
                const isBooked = seat.status === "BOOKED";
                const isHeldByOther = seat.status === "HELD";
                const isDisabled = disabled || isBooked || isHeldByOther;

                const classNames = [styles.seat];
                let symbol: string = String(seat.seatNumber);
                if (isSelected) {
                  classNames.push(styles.selected);
                  symbol = "✓";
                } else if (isBooked) {
                  classNames.push(styles.booked);
                  symbol = "✕";
                } else if (isHeldByOther) {
                  classNames.push(styles.held);
                  symbol = "●";
                }

                return (
                  <button
                    key={seat.id}
                    type="button"
                    className={classNames.join(" ")}
                    disabled={isDisabled}
                    onClick={() => onToggle(seat)}
                    aria-pressed={isSelected}
                    aria-label={`Seat ${seat.rowLabel}${seat.seatNumber}, ${describeStatus(seat, isSelected)}, ₹${seat.price.toFixed(2)}`}
                    title={`${seat.rowLabel}${seat.seatNumber}`}
                  >
                    {symbol}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <ul className={styles.legend}>
        <li>
          <span className={styles.swatch} /> Available
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.selected}`}>✓</span> Selected
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.held}`}>●</span> Held by someone else
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.booked}`}>✕</span> Booked
        </li>
      </ul>
    </div>
  );
}
