import { useEffect, useState } from "react";
import styles from "./Toast.module.css";

export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  // Kept mounted through the fade-out so the exit transition can play,
  // rather than vanishing the instant the caller clears the message.
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState<string | null>(null);

  useEffect(() => {
    if (message) {
      setRendered(message);
      const showTimer = setTimeout(() => setVisible(true), 10);
      const hideTimer = setTimeout(() => setVisible(false), 2600);
      const dismissTimer = setTimeout(onDismiss, 2900);
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        clearTimeout(dismissTimer);
      };
    }
    setVisible(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!rendered) return null;

  return (
    <div className={`${styles.toast} ${visible ? styles.visible : ""}`} role="status" aria-live="polite">
      {rendered}
    </div>
  );
}
