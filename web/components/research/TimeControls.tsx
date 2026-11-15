"use client";
// Time interaction (spec §9; acceptance §8): the VIEW range, the CURSOR and the ANALYSIS period are separate.
// Changing the view or selecting a range never changes a number. "Apply as analysis period" sends a NEW
// research request with the selection as a user period; the backend recomputes slopes, intervals, indicators
// and the correction. Nothing is recalculated in the browser.
import { useEffect, useId, useState } from "react";
import { Segmented } from "@/components/explore/Segmented";
import { isYm, periodLabel, timeLabel, ymIndex } from "@/lib/research/format";
import type { Period, ResolvedBlock } from "@/lib/research/types";
import { btnPrimary, btnQuiet, Card, Notice } from "./ui";
import type { TimeView } from "./VariableCard";

export type ViewMode = "full" | "analysis" | "selection";

export function TimeControls({
  time,
  mode,
  onMode,
  resolved,
  userRegionId,
  keepRegion,
  onKeepRegion,
  onApply,
  busy,
}: {
  time: TimeView;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  resolved: ResolvedBlock;
  /** the region the user chose for the shown result, if any */
  userRegionId: string | null;
  keepRegion: boolean;
  onKeepRegion: (keep: boolean) => void;
  onApply: () => void;
  busy: boolean;
}) {
  const id = useId();
  const analysis: Period | null = resolved.period ? { start: resolved.period.start, end: resolved.period.end } : null;
  const brush = time.brush;
  const [from, setFrom] = useState(brush?.start ?? "");
  const [to, setTo] = useState(brush?.end ?? "");
  // the text fields follow a selection made on a chart
  useEffect(() => { setFrom(brush?.start ?? ""); setTo(brush?.end ?? ""); }, [brush?.start, brush?.end]);
  const typed = (a: string, b: string) => {
    setFrom(a); setTo(b);
    if (isYm(a.trim()) && isYm(b.trim()) && ymIndex(a.trim()) <= ymIndex(b.trim())) time.setBrush({ start: a.trim(), end: b.trim() });
  };
  const incomplete = (from.trim() !== "" || to.trim() !== "") && !(isYm(from.trim()) && isYm(to.trim()) && ymIndex(from.trim()) <= ymIndex(to.trim()));
  const presetRegion = resolved.region && resolved.region.source === "preset" && !userRegionId ? resolved.region : null;
  const same = !!brush && !!analysis && brush.start === analysis.start && brush.end === analysis.end;

  return (
    <Card aria-labelledby={`${id}-h`} data-testid="time-controls">
      <h2 id={`${id}-h`} className="text-2xl">Time axis</h2>
      <p className="mt-1 max-w-[80ch] text-sm text-ink-2">
        Three separate things: the <strong>view range</strong> is what the charts show, the <strong>cursor</strong> reads one month, and the{" "}
        <strong>analysis period</strong> ({analysis ? periodLabel(analysis) : "none"}) is what the trends were fitted on. Only a new analysis changes the numbers.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div>
          <Segmented<ViewMode>
            legend="View range (display only)"
            tone="paper"
            value={mode}
            onChange={onMode}
            options={[
              { value: "full", label: "Full history" },
              ...(analysis ? [{ value: "analysis" as const, label: "Analysis period" }] : []),
              ...(brush ? [{ value: "selection" as const, label: "Selection" }] : []),
            ]}
          />
          <p className="mt-1.5 text-[0.8125rem] text-ink-3" aria-live="polite">
            Cursor: {time.cursor ? timeLabel(time.cursor) : "move over a chart, or focus one and use the arrow keys"}
          </p>
        </div>

        <fieldset className="min-w-0">
          <legend className="text-sm text-ink-2">Selection to analyse next (drag on a chart, or type both months)</legend>
          <div className="mt-1.5 flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-sm text-ink-2">
              Selection start
              <input name="brush-from" type="text" inputMode="numeric" placeholder="YYYY-MM" maxLength={7} value={from} onChange={(e) => typed(e.target.value, to)}
                className="mt-1 w-32 rounded-ctl border border-line bg-paper px-3 py-1.5 text-ink tnum placeholder:text-ink-3" />
            </label>
            <label className="flex flex-col text-sm text-ink-2">
              Selection end
              <input name="brush-to" type="text" inputMode="numeric" placeholder="YYYY-MM" maxLength={7} value={to} onChange={(e) => typed(from, e.target.value)}
                className="mt-1 w-32 rounded-ctl border border-line bg-paper px-3 py-1.5 text-ink tnum placeholder:text-ink-3" />
            </label>
            <button type="button" className={btnPrimary} disabled={!brush || busy || incomplete} onClick={onApply} data-testid="apply-period">
              Apply as analysis period
            </button>
            {(brush || from || to) && (
              <button type="button" className={btnQuiet} onClick={() => { time.setBrush(null); setFrom(""); setTo(""); if (mode === "selection") onMode("full"); }}>
                Clear selection
              </button>
            )}
          </div>
          {incomplete && (
            <p role="alert" className="mt-2 text-sm font-semibold text-ink"><span aria-hidden="true">! </span>Write both months as YYYY-MM, with the start not after the end.</p>
          )}
          {brush && !incomplete && (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-ink-2" data-testid="brush-summary">
                Selected {periodLabel(brush)}{same ? ", the same as the current analysis period" : ""}. Applying it starts a new analysis with this as <strong>your</strong> period: slope, confidence interval, indicators and the correction are recomputed by the analysis service. The fixed reference periods do not move.
              </p>
              {presetRegion && (
                <label className="flex items-start gap-2 text-sm text-ink-2">
                  <input type="checkbox" className="mt-1" checked={keepRegion} onChange={(e) => onKeepRegion(e.target.checked)} data-testid="keep-region" />
                  <span>
                    Keep <span className="font-semibold text-ink">{presetRegion.name}</span> for the new analysis. It was suggested by a preset; keeping it makes it your choice. Unticked, a preset may suggest a different region for the new period.
                  </span>
                </label>
              )}
            </div>
          )}
          {!brush && !incomplete && (
            <Notice tone="info" className="mt-2">Nothing is selected. Zooming the view does not change any result.</Notice>
          )}
        </fieldset>
      </div>
    </Card>
  );
}
