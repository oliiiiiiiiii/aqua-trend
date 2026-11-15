import type { ReactNode } from "react";

/** Plain loading / failure / empty message on paper. */
export function StatusCard({
  title,
  children,
  action,
  busy = false,
  className = "",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={`rounded-card bg-paper p-5 text-ink shadow-card ${className}`} role={busy ? "status" : undefined} aria-busy={busy || undefined}>
      <p className="flex items-center gap-2.5 font-semibold">
        {busy && <span aria-hidden="true" className="inline-block h-3 w-3 animate-pulse rounded-full bg-water" />}
        {title}
      </p>
      {children && <div className="mt-1.5 space-y-2 text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function RetryButton({ onClick, children = "Try again" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-ctl bg-action px-4 py-2 font-semibold text-on-action hover:bg-action-hover">
      {children}
    </button>
  );
}
