"use client";
import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import type { Catalog, Region } from "@/lib/types";
import { LAYER_LABEL } from "@/lib/data";
import { buildIndex, countMatches, formatArea, formatCount, searchRegions } from "./regionUtils";

const LIMIT = 30;

/** Text alternative to clicking the globe: a combobox over every region in the catalogue. */
export function RegionSearch({ catalog, onSelect, autoFocus = false }: { catalog: Catalog; onSelect: (r: Region) => void; autoFocus?: boolean }) {
  const id = useId();
  const listId = `${id}-list`;
  const index = useMemo(() => buildIndex(catalog.regions), [catalog]);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query);
  const results = useMemo(() => searchRegions(index, q, LIMIT), [index, q]);
  const total = useMemo(() => (q.trim() ? countMatches(index, q) : 0), [index, q]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const open = q.trim().length > 0;
  const activeIdx = Math.min(active, Math.max(0, results.length - 1));

  function move(to: number) {
    const n = results.length;
    if (!n) return;
    const next = (to + n) % n;
    setActive(next);
    listRef.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); move(activeIdx + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(activeIdx - 1); }
    else if (e.key === "Enter" && open && results[activeIdx]) { e.preventDefault(); onSelect(results[activeIdx]); }
    else if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); }
  }

  return (
    <div>
      <label htmlFor={`${id}-input`} className="block font-semibold text-ink">
        Search regions
      </label>
      <p id={`${id}-hint`} className="text-sm text-ink-3">
        Name, region id or country code, across all {formatCount(catalog.regions.length)} boundaries.
      </p>
      <input
        id={`${id}-input`}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={`${id}-hint`}
        aria-activedescendant={open && results.length ? `${id}-opt-${activeIdx}` : undefined}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        data-dialog-autofocus={autoFocus || undefined}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={onKeyDown}
        className="mt-2 w-full rounded-ctl border border-line bg-paper px-4 py-2.5 text-ink placeholder:text-ink-3"
      />
      <p className="sr-only" aria-live="polite">
        {open ? (total ? `${total} matches${total > LIMIT ? `, showing the first ${LIMIT}` : ""}` : "No matches") : ""}
      </p>
      {open && (
        <div className="mt-2">
          <p className="text-sm text-ink-3 tnum" aria-hidden="true">
            {total === 0
              ? "No region matches. Try a river, a country code such as IND, or part of an id."
              : total > LIMIT
                ? `${formatCount(total)} matches, showing the best ${LIMIT}`
                : `${formatCount(total)} ${total === 1 ? "match" : "matches"}`}
          </p>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Matching regions"
            className="mt-1 max-h-80 overflow-y-auto rounded-card border border-line"
          >
            {results.map((r, i) => (
              <li
                key={r.id}
                id={`${id}-opt-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(r)}
                onMouseMove={() => i !== activeIdx && setActive(i)}
                className={`cursor-pointer border-b border-line px-3 py-2 last:border-b-0 ${i === activeIdx ? "bg-well" : ""}`}
              >
                <span className="block font-medium text-ink">{r.name}</span>
                <span className="block text-sm text-ink-3">
                  {LAYER_LABEL[r.type]}, <span className="tnum">{formatArea(r.areaKm2)}</span>
                  {r.iso?.length ? <>, {r.iso.slice(0, 4).join(" ")}</> : null}
                  {!r.cells ? <>, no land-model data</> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
