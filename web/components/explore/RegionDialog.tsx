"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Modal overlay built on the native <dialog>: showModal() gives the focus trap, inert background and Esc to close;
 * focus returns to the opener on close. Full-screen sheet below 640 px. Children mount only while open, so the
 * globe's WebGL context exists only then.
 */
export function RegionDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
      d.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();
      document.body.style.overflow = "hidden";
    } else if (!open && d.open) {
      d.close();
    }
    if (!open) {
      document.body.style.overflow = "";
      opener.current?.focus({ preventScroll: true });
      opener.current = null;
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="on-stage stage-sky m-auto h-dvh max-h-none w-screen max-w-none overflow-y-auto p-0 backdrop:bg-black/60 sm:h-[min(52rem,92dvh)] sm:w-[min(80rem,94vw)] sm:rounded-card sm:shadow-card"
    >
      {open && (
        <div className="flex min-h-full flex-col">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-stage-line bg-stage px-4 py-2.5 sm:px-6">
            <h2 id={titleId} className="text-xl">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-ctl border border-stage-line px-4 py-1.5 text-sm font-semibold hover:bg-stage-line"
            >
              Close
            </button>
          </div>
          <div className="flex-1 px-4 py-4 sm:px-6 sm:py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
