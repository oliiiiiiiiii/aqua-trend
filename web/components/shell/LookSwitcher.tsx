"use client";
import { LOOKS, setLook, useLookId, type LookId } from "@/lib/look";

/**
 * Preview tool for the team: pick a visual style (look). A native select, so it is keyboard and screen-reader
 * accessible for free and works at phone width, where the "Style" word drops out and the palette icon stays.
 */
export function LookSwitcher() {
  const look = useLookId();
  const note = LOOKS.find((l) => l.id === look)?.note;
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-ctl border border-stage-line pr-1 pl-2.5 text-sm text-on-stage-2 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-on-stage">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
        <circle cx="7.5" cy="11" r="1" fill="currentColor" />
        <circle cx="11" cy="7" r="1" fill="currentColor" />
        <circle cx="15.5" cy="8" r="1" fill="currentColor" />
      </svg>
      <span className="hidden sm:inline">Style</span>
      <select
        value={look}
        onChange={(e) => setLook(e.target.value as LookId)}
        aria-label="Visual style"
        title={note}
        className="h-7 max-w-[7.5rem] cursor-pointer rounded-ctl bg-transparent pr-1 text-sm font-semibold text-on-stage outline-none"
      >
        {LOOKS.map((l) => (
          <option key={l.id} value={l.id} className="bg-paper text-ink">
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
