import { useState } from "react";
import styles from "./Poster.module.css";

// A deterministic gradient (by movie title) so shows without a poster still
// look intentional rather than broken.
const GRADIENTS = [
  "linear-gradient(135deg,#e11d2e,#7a0f1c)",
  "linear-gradient(135deg,#1d2be1,#0c1470)",
  "linear-gradient(135deg,#e18a1d,#7a4a0c)",
  "linear-gradient(135deg,#1de1a6,#0c705a)",
  "linear-gradient(135deg,#a11de1,#4a0c70)",
];

function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[hash % GRADIENTS.length];
}

export function Poster({ src, title, className }: { src: string | null; title: string; className?: string }) {
  // Falls back to the gradient placeholder both when no URL was given AND
  // when a given URL fails to actually load (dead link, wrong domain, ...).
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={`${title} poster`}
        className={`${styles.image} ${className ?? ""}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${styles.fallback} ${className ?? ""}`}
      style={{ background: gradientFor(title) }}
      role="img"
      aria-label={`${title} poster`}
    >
      <span>{title}</span>
    </div>
  );
}
