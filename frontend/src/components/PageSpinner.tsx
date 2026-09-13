import styles from "./PageSpinner.module.css";

export function PageSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={styles.container} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
