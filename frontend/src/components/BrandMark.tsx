export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M9 12a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3.2a2.2 2.2 0 0 0 0 4.4V23a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3v-3.4a2.2 2.2 0 0 0 0-4.4V12Z"
        fill="#ffffff"
      />
      <rect x="14.2" y="10" width="1.8" height="12" rx="0.9" fill="currentColor" />
    </svg>
  );
}
