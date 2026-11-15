"use client";
// Analysis lab: a row of icon buttons, one per test. Each runs on the residual series
// (raw − seasonal cycle − long-term trend) over the chosen range and shows the numbers,
// a one-line verdict, and (on the residual layer) a fit line on the chart.
import type { ReactNode } from "react";
import type { TimeRange } from "@/lib/detective/contracts";
import {
  LAB_GROUPS, type AcfResult, type BootstrapResult, type HistBin, type LabOutcome, type LabStats, type LabToolId, type NormalityResult,
} from "@/lib/detective/lab";
import { Segmented } from "@/components/explore/Segmented";
import { num, pValue, rangeLabel } from "./format";
import { Histogram, I, Rows, Sig, Verdict, ci, corrected, dot, slopeUnit, type ToolInfo } from "./LabParts";
import { MoreResult, MORE_TOOL_INFO } from "./LabMore";
import { MlResult, ML_TOOL_INFO } from "./LabMl";

export type LabRangeSource = "selection" | "event" | "all";

export interface LabPanelProps {
  tool: LabToolId | null;
  onToolChange: (t: LabToolId | null) => void;
  source: LabRangeSource;
  onSourceChange: (s: LabRangeSource) => void;
  hasSelection: boolean;
  range: TimeRange | null;
  outcome: LabOutcome | null;
  unit: string;
  /** d.months, for labelling month indices */
  months: readonly string[];
  /** months between the first and last month of the range, for slope units */
  spanMonths: number;
  /** the range is (almost) the baseline the trend was removed on */
  baselineWarning: boolean;
  /** the fit line exists but the chart is not on the residual layer */
  onShowResidual?: () => void;
  /** every test run on this range so far, with its p-value and whether it survives Holm's correction */
  log: LabLogEntry[];
}

export interface LabLogEntry { tool: LabToolId; p: number | null; holm: boolean }


export const TOOL_INFO: Record<LabToolId, ToolInfo> = {
  ...MORE_TOOL_INFO,
  ...ML_TOOL_INFO,
  ols: {
    label: "迴歸", title: "線性迴歸＋t 檢定",
    about: "用最小平方法畫一條直線，斜率代表這段期間異常的變化速率；t 檢定判斷斜率是否可能只是 0 加上隨機起伏。",
    icon: I(<>{dot(5, 17)}{dot(8, 13)}{dot(11, 15)}{dot(14, 10)}{dot(17, 11)}{dot(19, 6)}<path d="M3 19 L21 5" /></>),
  },
  mk: {
    label: "MK", title: "Mann–Kendall＋Sen 斜率",
    about: "不假設直線或常態分布：只看每一對月份「後面比前面高還是低」。Sen 斜率是所有兩點斜率的中位數，不怕極端值。",
    icon: I(<><path d="M3 19 h4 v-4 h4 v-4 h4 v-4 h6" /><path d="M17 3 l4 4" /></>),
  },
  mean: {
    label: "平均", title: "單樣本 t 檢定（平均異常 ≠ 0？）",
    about: "這段期間平均比正常值高或低多少？t 檢定判斷這個偏離是否大到不太可能只是隨機。",
    icon: I(<><path d="M3 9 H21" />{dot(5, 5)}{dot(9, 13)}{dot(13, 6)}{dot(17, 11)}{dot(20, 4)}<path d="M3 19 H21" strokeDasharray="2 3" /></>),
  },
  wilcoxon: {
    label: "符號秩", title: "Wilcoxon 符號秩檢定（中位數 ≠ 0？）",
    about: "平均檢定的無母數版本：不假設常態分布，用「高於正常的月份比較多、比較大嗎」來判斷。",
    icon: I(<><path d="M3 12 H21" /><path d="M6 12 V6 M10 12 V8 M14 12 V5 M18 12 V15" /></>),
  },
  compare: {
    label: "比較", title: "這段 vs 其餘期間（Welch t、Mann–Whitney U）",
    about: "把選取範圍和其他所有月份比較：兩段的平均（Welch t 檢定）與整體分布（Mann–Whitney U 檢定）有沒有差別？",
    icon: I(<><rect x="4" y="7" width="6" height="9" rx="1" /><path d="M7 4 V7 M7 16 V20 M4 11.5 H10" /><rect x="14" y="10" width="6" height="7" rx="1" /><path d="M17 6 V10 M17 17 V21 M14 13 H20" /></>),
  },
  pettitt: {
    label: "轉折", title: "Pettitt 轉折點檢定",
    about: "找出序列「突然換了一個水準」的時間點。突變（例如蓋水庫、換儀器）用直線趨勢去描述會誤導。",
    icon: I(<><path d="M3 16 H11 V8 H21" /><path d="M11 3 V21" strokeDasharray="2 3" /></>),
  },
  acf: {
    label: "自相關", title: "自相關（ACF）＋Ljung–Box 檢定",
    about: "這個月的異常會延續到下個月嗎？自相關高代表有效樣本變少，所有檢定的 p 值都需要修正（本頁的檢定已修正）。",
    icon: I(<><path d="M3 20 H21" /><path d="M5 20 V5 M9 20 V9 M13 20 V13 M17 20 V16 M21 20 V18" /></>),
  },
  normality: {
    label: "分布", title: "分布與常態性（直方圖、Jarque–Bera）",
    about: "異常值的分布是不是鐘形？偏態代表一邊有較多極端值，峰態高代表極端值比常態分布多。t 檢定假設接近常態。",
    icon: I(<><path d="M3 19 C7 19 8 5 12 5 C16 5 17 19 21 19" /><path d="M3 21 H21" /></>),
  },
  bootstrap: {
    label: "拔靴", title: "區塊拔靴法（重抽樣 2000 次）",
    about: "不靠公式：把資料切成小區塊、重新抽樣 2000 次，看平均和斜率會落在哪裡。結果直接畫成直方圖。",
    icon: I(<><path d="M20 12 a8 8 0 1 1 -3 -6.2" /><path d="M20 3 V7 H16" /><path d="M9 15 V12 M12 15 V9 M15 15 V11" /></>),
  },
};

const btn = "flex w-[3.75rem] flex-col items-center gap-0.5 rounded-ctl border px-1 pb-1 pt-1.5 text-xs disabled:opacity-40";
const off = `${btn} border-line bg-paper text-ink-2 hover:bg-well hover:text-ink`;
const on = `${btn} border-focus bg-well font-semibold text-ink`;

export default function LabPanel(p: LabPanelProps) {
  const sources = [
    { value: "selection" as const, label: "選取區間", title: p.hasSelection ? "數線上拖曳選取的範圍" : "先在數線上按住 Shift 拖曳（或開啟「選取」）選一段時間" },
    { value: "event" as const, label: "事件期間", title: "目前設定的事件期間" },
    { value: "all" as const, label: "全時段", title: "整段資料" },
  ];
  return (
    <section aria-label="分析工具" className="rounded-card border border-line px-4 py-3" style={{ borderRadius: "min(var(--r-card), 14px)" }}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-sm font-semibold text-ink">分析工具 <span className="font-normal text-ink-2">· 對殘差（異常）做檢定</span></h3>
        <Segmented
          legend="分析範圍" hideLegend tone="paper" value={p.source}
          onChange={(v) => { if (v !== "selection" || p.hasSelection) p.onSourceChange(v); }}
          options={sources.map((s) => ({ ...s, label: s.value === "selection" && !p.hasSelection ? <span className="opacity-50">{s.label}</span> : s.label }))}
        />
      </div>

      <div role="toolbar" aria-label="選擇分析" className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
        {LAB_GROUPS.map((g) => (
          <div key={g.label} role="group" aria-label={g.label} className="min-w-0">
            <div className="mb-1 text-xs text-ink-2">{g.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {g.tools.map((t) => {
                const info = TOOL_INFO[t];
                const active = p.tool === t;
                return (
                  <button key={t} type="button" className={active ? on : off} aria-pressed={active} title={info.title}
                    onClick={() => p.onToolChange(active ? null : t)}>
                    {info.icon}
                    <span className="leading-tight">{info.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {p.tool == null ? (
        <p className="mt-2.5 text-sm text-ink-2">
          在數線上選一段時間（或選「事件期間」「全時段」），再按一個工具。結果會隨範圍即時更新。
        </p>
      ) : (
        <div aria-live="polite" className="mt-3 text-sm text-ink">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{TOOL_INFO[p.tool].title}</span>
            {p.range && <span className="text-ink-2 tnum">· {rangeLabel(p.range)}</span>}
          </div>
          <p className="mt-0.5 text-ink-2">{TOOL_INFO[p.tool].about}</p>

          {p.baselineWarning && (
            <p role="note" className="mt-2 rounded-ctl bg-synthetic-bg px-3 py-1.5 text-synthetic" style={{ borderRadius: "min(var(--r-ctl), 10px)" }}>
              這段範圍幾乎就是用來擬合長期趨勢的基準期，殘差的平均與趨勢在計算上就會接近 0。選一段較短的期間（例如事件或最近十年）結果才有意義。
            </p>
          )}

          {p.outcome == null ? null : p.outcome.kind === "insufficient" ? (
            <p className="mt-2 text-ink-2">
              {p.outcome.note ?? `資料不足：這段只有 ${p.outcome.n} 個有值的月份，${p.outcome.what}至少需要 ${p.outcome.need} 個月。請選長一點的範圍。`}
            </p>
          ) : (
            <>
              <Result s={p.outcome.stats} unit={p.unit} spanMonths={p.spanMonths} months={p.months} />
              {p.outcome.segments.length > 0 && p.onShowResidual && (
                <p className="mt-2 text-ink-2">
                  擬合線畫在殘差圖層上。<button type="button" className="text-link underline underline-offset-2" onClick={p.onShowResidual}>切換到殘差</button>
                </p>
              )}
            </>
          )}
        </div>
      )}

      <TestLog log={p.log} />
    </section>
  );
}

/* ------------------------------------------------------------------ result blocks */

function Result({ s, unit, spanMonths, months }: { s: LabStats; unit: string; spanMonths: number; months: readonly string[] }) {
  const su = slopeUnit(spanMonths);
  switch (s.tool) {
    case "ols": return (
      <>
        <Rows rows={[
          ["斜率", <b key="s">{num(s.slope * su.k, 2, true)} {unit}{su.label}</b>],
          ["95% 信賴區間", `${ci(s.ci95, su.k)} ${unit}${su.label}`],
          ["t／自由度", `t = ${num(s.t, 2, true)}，df ≈ ${num(s.df, 1)}`],
          ["p 值", <span key="p">{pValue(s.p)} <Sig p={s.p} /></span>],
          ["未修正 p", `${pValue(s.naive.p)}（假設每個月互相獨立）`],
          ["R²", `${num(s.r2, 2)}（直線解釋了 ${Math.round(s.r2 * 100)}% 的起伏）`],
        ]} />
        <p className="mt-1">{corrected(s.nEff, s.n, s.lag1)}</p>
        <Verdict>
          {s.p < 0.05
            ? `這段期間的異常有明顯${s.slope > 0 ? "上升" : "下降"}的趨勢，信賴區間不包含 0。`
            : "信賴區間包含 0：這段期間看不出可靠的直線變化，可能只是隨機起伏。"}
        </Verdict>
      </>
    );
    case "mk": return (
      <>
        <Rows rows={[
          ["Sen 斜率", <b key="s">{num(s.sen * su.k, 2, true)} {unit}{su.label}</b>],
          ["95% 信賴區間", `${ci(s.ci95, su.k)} ${unit}${su.label}`],
          ["S／Kendall τ", `S = ${s.S}，τ = ${num(s.tau, 2, true)}`],
          ["z", num(s.z, 2, true)],
          ["p 值", <span key="p">{pValue(s.p)} <Sig p={s.p} /></span>],
          ["未修正 p", pValue(s.pNaive)],
        ]} />
        <p className="mt-1">{corrected(s.nEff, s.n, s.lag1)}</p>
        <Verdict>
          {s.p < 0.05
            ? `後面的月份系統性地比前面${s.S > 0 ? "高" : "低"}，這是單調${s.S > 0 ? "上升" : "下降"}的趨勢。`
            : "高低順序看不出一致的方向。"}
        </Verdict>
      </>
    );
    case "mean": return (
      <>
        <Rows rows={[
          ["平均異常", <b key="m">{num(s.mean, 2, true)} {unit}</b>],
          ["95% 信賴區間", `${ci(s.ci95)} ${unit}`],
          ["標準差", `${num(s.sd, 2)} ${unit}`],
          ["t／自由度", `t = ${num(s.t, 2, true)}，df ≈ ${num(s.df, 1)}`],
          ["p 值", <span key="p">{pValue(s.p)} <Sig p={s.p} /></span>],
          ["效果量 d", `${num(s.effect, 2, true)}（|d| ≥ 0.8 算大）`],
        ]} />
        <p className="mt-1">{corrected(s.nEff, s.n, s.lag1)}</p>
        <Verdict>
          {s.p < 0.05
            ? `這段期間平均${s.mean > 0 ? "高於" : "低於"}正常值，而且不太可能只是巧合。`
            : "平均和正常值的差距，在隨機起伏的範圍內。"}
        </Verdict>
      </>
    );
    case "wilcoxon": return (
      <>
        <Rows rows={[
          ["中位數異常", <b key="m">{num(s.median, 2, true)} {unit}</b>],
          ["高於正常的月份", `${Math.round(s.positiveShare * 100)}%`],
          ["W⁺／z", `W⁺ = ${num(s.wPlus, 1)}，z = ${num(s.z, 2, true)}`],
          ["p 值", <span key="p">{pValue(s.p)} <Sig p={s.p} /></span>],
        ]} />
        <p className="mt-1">{corrected(s.nEff, s.n, s.lag1)}</p>
        <Verdict>
          {s.p < 0.05 ? `大部分月份都${s.z > 0 ? "高於" : "低於"}正常值，方向一致。` : "高於和低於正常的月份差不多，看不出一致的偏離。"}
        </Verdict>
      </>
    );
    case "compare": return (
      <>
        <Rows rows={[
          ["這段平均", `${num(s.a.mean, 2, true)} ${unit}（${s.a.n} 個月）`],
          ["其餘平均", `${num(s.b.mean, 2, true)} ${unit}（${s.b.n} 個月）`],
          ["差值", <b key="d">{num(s.diff, 2, true)} {unit}，95% CI {ci(s.welch.ci95)}</b>],
          ["Welch t", <span key="w">t = {num(s.welch.t, 2, true)}，p {pValue(s.welch.p)} <Sig p={s.welch.p} /></span>],
          ["Mann–Whitney U", <span key="u">U = {num(s.mannWhitney.U, 0)}，p {pValue(s.mannWhitney.p)} <Sig p={s.mannWhitney.p} /></span>],
          ["這段 > 其餘的機率", `${Math.round(s.mannWhitney.probSuperiority * 100)}%（50% 表示沒差）`],
        ]} />
        <p className="mt-1 text-ink-2">Welch t 已用兩段各自的有效樣本修正自相關；U 檢定未修正，p 值偏樂觀。</p>
        <Verdict>
          {s.welch.p < 0.05
            ? `這段期間明顯比其餘時間${s.diff > 0 ? "高" : "低"}。`
            : "這段期間和其餘時間沒有可靠的差別。"}
        </Verdict>
      </>
    );
    case "pettitt": return (
      <>
        <Rows rows={[
          ["轉折後第一個月", <b key="t">{months[s.splitAt + 1] ?? "—"}</b>],
          ["之前平均", `${num(s.meanBefore, 2, true)} ${unit}（${s.nBefore} 個月）`],
          ["之後平均", `${num(s.meanAfter, 2, true)} ${unit}（${s.nAfter} 個月）`],
          ["變化量", `${num(s.meanAfter - s.meanBefore, 2, true)} ${unit}`],
          ["K／p 值", <span key="p">K = {s.K}，p {pValue(s.p)} <Sig p={s.p} /></span>],
        ]} />
        <p className="mt-1 text-ink-2">p 值為近似值，未修正自相關；持續的季節外起伏也可能看起來像轉折。</p>
        <Verdict>
          {s.p < 0.05 ? "序列在這個時間點附近突然換了一個水準。" : "找不到可靠的單一突變點。"}
        </Verdict>
      </>
    );
    case "acf": return <AcfBlock s={s} />;
    case "normality": return <NormalityBlock s={s} unit={unit} />;
    case "bootstrap": return <BootstrapBlock s={s} unit={unit} su={su} />;
    case "analog": case "hmm": case "forecast": case "discord": case "iforest": case "bocpd": case "gp":
      return <MlResult s={s} unit={unit} months={months} />;
    default: return <MoreResult s={s} unit={unit} spanMonths={spanMonths} months={months} />;
  }
}

function AcfBlock({ s }: { s: AcfResult }) {
  const W = 320, H = 96, mid = H / 2, step = W / s.acf.length;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block h-24 w-full max-w-md" preserveAspectRatio="none" aria-label="自相關圖，各延遲月數的相關係數">
        <rect x={0} y={mid - s.band * mid} width={W} height={2 * s.band * mid} style={{ fill: "var(--ink)", opacity: 0.07 }} />
        <line x1={0} x2={W} y1={mid} y2={mid} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--ink-3)" }} />
        {s.acf.map((r, k) => r == null ? null : (
          <g key={k}>
            <line x1={step * (k + 0.5)} x2={step * (k + 0.5)} y1={mid} y2={mid - r * mid} strokeWidth={3} vectorEffect="non-scaling-stroke"
              style={{ stroke: Math.abs(r) > s.band ? "var(--viz-blue)" : "var(--ink-3)" }} />
          </g>
        ))}
      </svg>
      <div className="flex max-w-md justify-between text-xs text-ink-2 tnum"><span>延遲 1 個月</span><span>灰帶：±1.96/√n</span><span>{s.acf.length} 個月</span></div>
      <Rows rows={[
        ["lag 1／lag 12", `${num(s.acf[0], 2, true)}／${num(s.acf[11], 2, true)}`],
        ["Ljung–Box", <span key="q">Q = {num(s.ljungBox.Q, 1)}，df = {s.ljungBox.df}，p {pValue(s.ljungBox.p)}</span>],
      ]} />
      <Verdict>
        {s.ljungBox.p < 0.05
          ? "異常會延續好幾個月（記憶效應）。這很常見，例如土壤水和地下水；也表示獨立樣本比月份數少。"
          : "看不出明顯的延續，每個月的異常大致互相獨立。"}
      </Verdict>
    </>
  );
}

function NormalityBlock({ s, unit }: { s: NormalityResult; unit: string }) {
  const pdf = (x: number) => Math.exp(-0.5 * ((x - s.mean) / s.sd) ** 2) / (s.sd * Math.sqrt(2 * Math.PI));
  return (
    <>
      <Histogram bins={s.hist} curve={pdf} marks={[{ at: 0, dashed: true, color: "var(--ink-3)" }]} label="殘差直方圖與常態曲線" />
      <p className="max-w-md text-xs text-ink-2">長條：各區間的月份數；黑線：同平均、同標準差的常態分布；虛線：0（正常值）。單位 {unit}</p>
      <Rows rows={[
        ["偏態", `${num(s.skew, 2, true)}${Math.abs(s.skew) > 0.5 ? (s.skew > 0 ? "（右尾長：偶爾特別高）" : "（左尾長：偶爾特別低）") : "（大致對稱）"}`],
        ["超額峰態", `${num(s.kurtosis, 2, true)}${s.kurtosis > 1 ? "（極端值比常態多）" : ""}`],
        ["Jarque–Bera", <span key="jb">JB = {num(s.jb, 2)}，p {pValue(s.p)}</span>],
      ]} />
      <Verdict>
        {s.p < 0.05
          ? "分布明顯不是常態。這時 Mann–Kendall、符號秩、拔靴法比 t 檢定更可靠。"
          : "和常態分布沒有明顯差別，t 檢定的假設大致成立。"}
      </Verdict>
    </>
  );
}

function BootstrapBlock({ s, unit, su }: { s: BootstrapResult; unit: string; su: { k: number; label: string } }) {
  const scale = (h: HistBin[]) => h.map((b) => ({ ...b, x0: b.x0 * su.k, x1: b.x1 * su.k }));
  return (
    <>
      <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
        <div>
          <Histogram bins={s.mean.hist} label="平均異常的拔靴分布"
            marks={[{ at: 0, dashed: true, color: "var(--ink-3)" }, { at: s.mean.ci95[0], color: "var(--focus)" }, { at: s.mean.ci95[1], color: "var(--focus)" }]} />
          <p className="text-xs text-ink-2">平均異常（{unit}）：{num(s.mean.est, 2, true)}，95% {ci(s.mean.ci95)}，p {pValue(s.mean.p)}</p>
        </div>
        <div>
          <Histogram bins={scale(s.slope.hist)} label="斜率的拔靴分布"
            marks={[{ at: 0, dashed: true, color: "var(--ink-3)" }, { at: s.slope.ci95[0] * su.k, color: "var(--focus)" }, { at: s.slope.ci95[1] * su.k, color: "var(--focus)" }]} />
          <p className="text-xs text-ink-2">斜率（{unit}{su.label}）：{num(s.slope.est * su.k, 2, true)}，95% {ci(s.slope.ci95, su.k)}，p {pValue(s.slope.p)}</p>
        </div>
      </div>
      <p className="mt-1 text-ink-2">重抽 {s.draws} 次，每塊 {s.block} 個連續月份（保留月與月之間的相關）。實線：95% 區間；虛線：0。</p>
      <Verdict>
        {s.mean.ci95[0] > 0 || s.mean.ci95[1] < 0 ? "平均異常的區間不含 0：這段期間確實偏離正常。" : "平均異常的區間包含 0。"}
        {" "}
        {s.slope.ci95[0] > 0 || s.slope.ci95[1] < 0 ? "斜率的區間不含 0：有可靠的趨勢。" : "斜率的區間包含 0：看不出可靠的趨勢。"}
      </Verdict>
    </>
  );
}

/** "You ran k tests on this range": the multiple-testing reminder, with Holm's correction. */
function TestLog({ log }: { log: LabLogEntry[] }) {
  const tested = log.filter((e): e is LabLogEntry & { p: number } => e.p != null && Number.isFinite(e.p));
  if (tested.length < 2) return null;
  const hits = tested.filter((e) => e.p < 0.05).length;
  const kept = tested.filter((e) => e.holm).length;
  return (
    <div className="mt-3 border-t border-line pt-2.5 text-sm">
      <p className="text-ink">
        這段範圍已做 <b>{tested.length}</b> 個檢定，其中 <b>{hits}</b> 個 p &lt; 0.05。
        <span className="text-ink-2">就算資料完全隨機，平均也會有約 {num(tested.length * 0.05, 1)} 個「顯著」。多試幾個再挑顯著的來報告，很容易誤判。</span>
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5 tnum">
        {tested.map((e) => (
          <li key={e.tool} title={TOOL_INFO[e.tool].title}
            className={`rounded-ctl px-2 py-0.5 text-xs ${e.holm ? "bg-real-bg font-semibold text-real" : e.p < 0.05 ? "bg-synthetic-bg text-synthetic" : "bg-well text-ink-2"}`}>
            {TOOL_INFO[e.tool].label} p {pValue(e.p)}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-ink-2">
        綠色：經 Holm 多重比較修正後仍顯著（{kept} 個）；橘色：單看顯著，但修正後不顯著；灰色：不顯著。不同檢定問的問題不一樣，修正只是提醒，不是唯一標準。
      </p>
    </div>
  );
}
