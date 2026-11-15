"use client";
// Long-term trend (the official "rate of change" + "significance" requirement), collapsed by default.
import type { TrendStats } from "@/lib/detective/contracts";
import { num, pValue } from "./format";

export interface TrendPanelProps {
  stats: TrendStats;
  unit: string;
  /** "1998-01..2025-09", the record the trend is computed on */
  record?: string;
  defaultOpen?: boolean;
}

export function trendSummary(s: TrendStats, unit: string): string {
  if (s.senPerDecade == null) return "資料不足，無法估計長期趨勢";
  const sig = s.significant == null ? "" : s.significant ? "，顯著" : "，不顯著";
  return `${num(s.senPerDecade, 2, true)} ${unit}／十年${s.mkP != null ? `，p ${s.mkP < 0.001 ? "" : "= "}${pValue(s.mkP)}` : ""}${sig}`;
}

export default function TrendPanel({ stats: s, unit, record, defaultOpen = false }: TrendPanelProps) {
  const sig = s.significant;
  return (
    <details open={defaultOpen} className="group rounded-card border border-line" style={{ borderRadius: "min(var(--r-card), 14px)" }}>
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block w-3 text-ink-3 transition-transform group-open:rotate-90">▸</span>
        <span className="font-semibold text-ink">長期趨勢</span>
        <span className="min-w-0 text-ink-2 tnum">{trendSummary(s, unit)}</span>
      </summary>
      <div className="border-t border-line px-4 py-3 text-sm text-ink">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 tnum">
          <dt className="text-ink-2">變化速率（Sen&apos;s slope）</dt>
          <dd className="font-semibold">{s.senPerDecade == null ? "—" : `${num(s.senPerDecade, 2, true)} ${unit}／十年`}</dd>
          <dt className="text-ink-2">95% 信賴區間</dt>
          <dd>{s.ci95 ? `[${num(s.ci95[0], 2, true)}, ${num(s.ci95[1], 2, true)}] ${unit}／十年` : "—"}</dd>
          <dt className="text-ink-2">Mann–Kendall p 值</dt>
          <dd>{pValue(s.mkP)}{s.nEff != null && <span className="text-ink-2">（有效樣本 {Math.round(s.nEff)}）</span>}</dd>
          <dt className="text-ink-2">顯著嗎？（α = 0.05）</dt>
          <dd>
            {sig == null ? "—" : (
              <span className={`inline-block rounded-ctl px-2 py-0.5 text-xs font-semibold ${sig ? "bg-real-bg text-real" : "bg-well text-ink-2"}`}>
                {sig ? "顯著" : "不顯著"}
              </span>
            )}
          </dd>
        </dl>
        <p className="mt-2.5 text-ink-2">
          {sig === false && (s.yearsToSignificance != null
            ? `如果這個速率維持不變，大約還需要 ${Math.ceil(s.yearsToSignificance)} 年的資料才可能看出顯著趨勢。`
            : "以目前的速率，50 年內的資料可能都看不出顯著趨勢。")}
          {sig === true && "這段期間的長期變化不太可能只是隨機起伏。"}
          {" "}
          趨勢在扣除季節循環後的{record ? `全期間（${record}）` : "全期間"}序列上計算，p 值已修正月資料的自相關。
        </p>
      </div>
    </details>
  );
}
