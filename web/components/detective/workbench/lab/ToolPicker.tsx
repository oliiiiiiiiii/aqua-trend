"use client";
// Two single-select rows without frames: the group (Trend · Mean · Extremes · Cycles, the lab's
// LAB_GROUPS) as underlined text tabs, then that group's tests in smaller text. Precise test names are in
// each option's title and accessible description; options the range cannot support are disabled with
// their minimum months beside them. Radios, so arrow keys move within a row. On phones the test row
// scrolls sideways instead of wrapping.
import { useEffect, useId, useRef } from "react";
import { COPY } from "../copy";
import { GROUPS, groupOf, pickInGroup, testsIn, type Availability, type TestGroup, type TestId } from "./tests";

interface Opt<T extends string> { value: T; label: string; title: string; disabled: boolean; /** e.g. "≥10", beside a disabled label */ hint?: string }

function Row<T extends string>({ legend, options, value, onChange, small }: {
  legend: string; options: Opt<T>[]; value: T; onChange: (v: T) => void; small?: boolean;
}) {
  const name = useId();
  // keep the chosen option in view when the row scrolls sideways (phones)
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current, on = row?.querySelector<HTMLElement>("[data-on]");
    if (!row || !on || row.scrollWidth <= row.clientWidth) return;
    const l = on.offsetLeft - row.offsetLeft, r = l + on.offsetWidth;
    if (l < row.scrollLeft) row.scrollLeft = l - 8;
    else if (r > row.scrollLeft + row.clientWidth) row.scrollLeft = r - row.clientWidth + 8;
  }, [value]);
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div ref={rowRef} className={small
        ? "-mx-1 flex flex-nowrap gap-x-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible"
        : "flex flex-wrap gap-x-4 gap-y-1"}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label
              key={o.value}
              data-on={on || undefined}
              title={o.title}
              className={`shrink-0 whitespace-nowrap has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
                small ? "rounded-[4px] px-1.5 py-0.5 text-xs" : "border-b-2 pb-0.5 text-sm"
              } ${
                o.disabled ? `cursor-not-allowed text-ink-3 ${small ? "" : "border-transparent"}`
                  : on ? `cursor-pointer font-semibold text-ink ${small ? "bg-paper ring-1 ring-line" : "border-ink"}`
                  : `cursor-pointer text-ink-2 hover:text-ink ${small ? "" : "border-transparent"}`
              }`}
            >
              <input type="radio" name={name} value={o.value} checked={on} disabled={o.disabled} onChange={() => onChange(o.value)}
                aria-description={o.title} className="sr-only" />
              {o.label}
              {o.disabled && o.hint && <span aria-hidden="true" className="ml-0.5 text-[10px] tnum">{o.hint}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function ToolPicker({ test, avail, onChange }: {
  test: TestId;
  avail: Record<TestId, Availability>;
  onChange: (t: TestId) => void;
}) {
  const L = COPY.lab;
  const group = groupOf(test);
  // the last test used in each group, so switching groups back and forth returns to it
  const last = useRef<Partial<Record<TestGroup, TestId>>>({});
  last.current[group] = test;
  const groupOk = (g: TestGroup) => testsIn(g).some((t) => avail[t].ok);
  const why = (g: TestGroup) => testsIn(g).map((t) => avail[t].reason).find(Boolean) ?? "";
  const hint = (ts: TestId[]) => {
    const needs = ts.filter((t) => avail[t].shortInRange).map((t) => avail[t].need);
    return needs.length ? L.minHint(Math.min(...needs)) : undefined;
  };
  return (
    <div className="flex min-w-0 flex-col gap-y-2">
      <Row<TestGroup>
        legend={L.groupLegend}
        value={group}
        onChange={(g) => onChange(pickInGroup(g, last.current[g], avail))}
        options={GROUPS.map((g) => ({
          value: g, label: L.group[g], disabled: !groupOk(g), hint: groupOk(g) ? undefined : hint(testsIn(g)),
          title: groupOk(g) ? L.groupTitle[g] : `${L.groupTitle[g]}. ${why(g)}`,
        }))}
      />
      <Row<TestId>
        small
        legend={L.methodLegend}
        value={test}
        onChange={onChange}
        options={testsIn(group).map((t) => ({
          value: t, label: L.test[t], disabled: !avail[t].ok, hint: hint([t]),
          title: avail[t].ok ? L.testTitle[t] : `${L.testTitle[t]}. ${avail[t].reason}`,
        }))}
      />
    </div>
  );
}
