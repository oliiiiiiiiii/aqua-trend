"use client";
// Compact stage header and the sticky selection / window toolbar.
import type { ReactNode } from "react";
import { COPY } from "./copy";
import { presetSpans, sameSpan, selectionLabel, type Span } from "./model";

export function StageHeader({ event, period, region, copied, onEdit, onShare }: {
  event: string; period: string; region: string; copied: boolean; onEdit: () => void; onShare: () => void;
}) {
  const S = COPY.stage;
  const ctl = "shrink-0 py-1 text-sm font-semibold underline-offset-4 hover:underline";
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
  view: Span; event: Span; sel: Span;
  onPreset: (s: Span) => void;
  /** the view window control (window/WindowControl) */
  window: ReactNode;
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
        className={`border-b-2 pb-px text-sm whitespace-nowrap disabled:opacity-40 ${on ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="z-20 border-b border-line bg-paper md:sticky md:top-0">
      <div role="toolbar" aria-label={T.label} className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-sm text-ink-2">{T.selection}</span>
          <div role="group" aria-label={T.selection} className="inline-flex items-baseline gap-x-3">
            {btn("b", T.before, T.beforeTitle, presets.before)}
            {btn("e", T.event, T.eventTitle, presets.event)}
            {btn("a", T.after, T.afterTitle, presets.after)}
          </div>
          <p className="text-sm text-ink tnum" aria-live="polite">
            <span className="font-semibold">{lbl.range}</span>
            <span className="text-ink-2"> · {lbl.length} · {lbl.relation}</span>
          </p>
        </div>
        <div className="w-full min-w-0 sm:w-auto lg:ml-auto lg:min-w-[27rem]">{p.window}</div>
      </div>
    </div>
  );
}
