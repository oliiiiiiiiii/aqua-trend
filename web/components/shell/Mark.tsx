// The TerraTrend mark: a water drop with land and an orbit ring. Uses theme tokens only.
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M16 2.5C16 2.5 6 13.2 6 19.6a10 10 0 0 0 20 0C26 13.2 16 2.5 16 2.5Z" fill="var(--water)" />
      <path d="M8.2 21.4c2.6-2.5 5.3-1.4 7.8-.2 2.6 1.3 5.1 2.3 7.8-.3a10 10 0 0 1-15.6.5Z" fill="var(--leaf)" />
      <ellipse
        cx="16" cy="19.6" rx="14" ry="3.6" fill="none" stroke="currentColor" strokeWidth="1.6"
        transform="rotate(-14 16 19.6)" strokeDasharray="15 6 40"
      />
      <circle cx="12.4" cy="14.2" r="2" fill="var(--paper)" opacity=".85" />
    </svg>
  );
}
