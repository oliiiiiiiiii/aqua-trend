"use client";
// Harness for workstream B (number line + variable tab) on fake data.
//   /dev/detective-chart?v=precip|tair|tws&layer=raw|seasonal|trend|residual&pad=12
import { useEffect, useMemo, useState } from "react";
import type { TimeRange } from "@/lib/detective/contracts";
import { THEMES, setTheme, useThemeId } from "@/lib/theme";
import VariableTab, { type VariableMeta } from "@/components/detective/VariableTab";
import type { ChartLayer } from "@/components/detective/SeriesChart";
import { fakeAnalysis, fakeSeries, type FakeKind } from "./fake";

const CASES: Record<FakeKind, { meta: VariableMeta; event: TimeRange; z: number; expected: "high" | "low" }> = {
  precip: {
    meta: { category: "precip", name: "降水", definition: "從天上落下的雨和雪有多少", product: "GPM IMERG", kind: "觀測", unit: "mm/day", caveat: null },
    event: { start: "2021-02", end: "2021-05" }, z: -2.6, expected: "low",
  },
  tair: {
    meta: { category: "tair", name: "氣溫", definition: "地面附近的空氣溫度", product: "GLDAS Noah 2.1 forcing", kind: "模式", unit: "°C", caveat: null },
    event: { start: "2019-09", end: "2020-01" }, z: 2.2, expected: "high",
  },
  tws: {
    meta: { category: "tws", name: "陸地儲水", definition: "地表、土壤、地下水加起來的總水量變化", product: "GRACE/GRACE-FO JPL mascon", kind: "觀測", unit: "cm", caveat: "GRACE 有效解析度約 300 km；大地震會造成非水文的重力跳動" },
    event: { start: "2021-02", end: "2021-05" }, z: -1.4, expected: "low",
  },
};

const sel = "max-w-full rounded-ctl border border-line bg-paper px-3 py-1.5 text-sm text-ink";

export default function DetectiveChartHarness() {
  const [kind, setKind] = useState<FakeKind>("precip");
  const [layer, setLayer] = useState<ChartLayer>("residual");
  const [pad, setPad] = useState(12);
  const [ready, setReady] = useState(false);
  const theme = useThemeId();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const v = q.get("v");
    if (v === "precip" || v === "tair" || v === "tws") setKind(v);
    const l = q.get("layer");
    if (l === "raw" || l === "seasonal" || l === "trend" || l === "residual") setLayer(l);
    if (q.get("pad")) setPad(Math.min(60, Math.max(3, Number(q.get("pad")) || 12)));
    setReady(true);
  }, []);

  const c = CASES[kind];
  const { d, trend } = useMemo(() => {
    const s = fakeSeries(kind, c.event, c.z);
    return { d: fakeAnalysis.decompose(s, c.event, pad), trend: fakeAnalysis.trendStats(s) };
  }, [kind, c, pad]);

  return (
    <div className="mx-auto max-w-4xl px-3 py-6 sm:px-4">
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-card bg-paper p-4 text-ink shadow-card">
        <label className="text-sm">
          <span className="mb-1 block font-semibold">假資料</span>
          <select className={sel} value={kind} onChange={(e) => setKind(e.target.value as FakeKind)}>
            <option value="precip">降水（台灣 2021 乾旱，z ≈ −2.6）</option>
            <option value="tair">氣溫（澳洲 2019，°C，z ≈ +2.2）</option>
            <option value="tws">陸地儲水（cm，含缺值與 caveat）</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">pad（月）</span>
          <input type="number" min={3} max={60} value={pad} onChange={(e) => setPad(Math.min(60, Math.max(3, Number(e.target.value) || 12)))} className={`${sel} w-20`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">主題</span>
          <select className={sel} value={theme} onChange={(e) => setTheme(e.target.value as (typeof THEMES)[number]["id"])}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-card bg-paper p-4 text-ink shadow-card sm:p-6">
        {ready && (
          <VariableTab
            key={`${kind}-${pad}`}
            meta={c.meta} d={d} event={c.event} padMonths={pad} trend={trend}
            intervalStats={fakeAnalysis.intervalStats} expected={c.expected} initialLayer={layer}
          />
        )}
      </div>
    </div>
  );
}
