"use client";
// Compact stage header and the sticky selection / window / order toolbar.
import { Segmented } from "@/components/ui/Segmented";
import { COPY } from "./copy";
import { presetSpans, sameSpan, selectionLabel, type Span } from "./model";

export function StageHeader({ event, period, region, copied, onEdit, onShare }: {
  event: string; period: string; region: string; copied: boolean; onEdit: () => void; onShare: () => void;
}) {
  const S = COPY.stage;
  const ctl = "shrink-0 rounded-ctl border border-stage-line px-3 py-1 text-sm font-semibold hover:bg-stage-line";
  return (
    <div className="on-stage stage-sky">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:px-6 lg:px-8">
        <button type="button" onClick={onEdit} title={S.editTitle} className={ctl}>
          <span aria-hidden="true">‹ </span>{S.edit}
        </button>
        <h1 className="min-w-0 flex-1 basis-60 text-xl leading-tight break-words sm:text-2xl">{event || S.untitled}</h1>
        <p className="flex flex-wrap items-baseline gap-x-3 text-sm text-on-stage-2">
          <span className="font-semibold text-on-stage">{period}</span>
          <span>{region}</span>
        </p>
        <button type="button" onClick={onShare} title={S.shareTitle} className={ctl} aria-live="polite">
          {copied ? S.copied : S.share}
        </button>
      </div>
    </div>
  );
}

export function Toolbar(p: {
  /** lets the page publish the toolbar height (--toolbar-h) for the sticky time axis */
  rootRef?: (el: HTMLDivElement | null) => void;
  view: Span; event: Span; sel: Span;
  pad: number; padChoices: number[]; showAll: boolean;
  order: "picked" | "unusual";
  onPreset: (s: Span) => void;
  onWindow: (v: "all" | number) => void;
  onOrder: (o: "picked" | "unusual") => void;
}) {
  const T = COPY.toolbar;
  const presets = presetSpans(p.view, p.event);
  const lbl = selectionLabel(p.sel, p.event);
  const btn = (key: string, label: string, title: string, span: Span | null) => {
    const on = !!span && sameSpan(span, p.sel);
    return (
      <button
        key={key} type="button" title={title} disabled={!span} aria-pressed={on}
        onClick={() => span && p.onPreset(span)}
        className={`rounded-ctl px-3 py-1 text-sm whitespace-nowrap disabled:opacity-40 ${on ? "bg-paper font-semibold text-ink shadow-card ring-1 ring-line" : "text-ink-2 hover:text-ink"}`}
      >
        {label}
      </button>
    );
  };
  const windowOptions = [
    ...p.padChoices.map((n) => ({ value: String(n), label: T.pad(n), title: T.windowTitle })),
    { value: "all", label: T.all, title: T.allTitle },
  ];
  return (
    <div ref={p.rootRef} className="z-20 border-b border-line bg-paper/95 backdrop-blur-sm md:sticky md:top-0">
      <div role="toolbar" aria-label={T.label} className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-semibold text-ink">{T.selection}</span>
          <div role="group" aria-label={T.selection} className="inline-flex gap-0.5 rounded-ctl border border-line bg-well p-0.5">
            {btn("b", T.before, T.beforeTitle, presets.before)}
            {btn("e", T.event, T.eventTitle, presets.event)}
            {btn("a", T.after, T.afterTitle, presets.after)}
          </div>
          <p className="text-sm text-ink tnum" aria-live="polite">
            <span className="font-semibold">{lbl.range}</span>
            <span className="text-ink-2"> · {lbl.length} · {lbl.relation}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:ml-auto">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-sm text-ink-2">{T.window}</span>
            <Segmented legend={T.window} hideLegend tone="paper" options={windowOptions} value={p.showAll ? "all" : String(p.pad)}
              onChange={(v) => p.onWindow(v === "all" ? "all" : Number(v))} />
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-sm text-ink-2">{T.order}</span>
            <Segmented legend={T.order} hideLegend tone="paper"
              options={[{ value: "picked", label: T.asPicked }, { value: "unusual", label: T.mostUnusual }]}
              value={p.order} onChange={p.onOrder} />
          </div>
        </div>
      </div>
    </div>
  );
}
