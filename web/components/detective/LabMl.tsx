"use client";
// Analysis lab, machine-learning group: classical, unsupervised methods fitted on this one series.
import type { ReactNode } from "react";
import type {
  AnalogResult, BocpdResult, DiscordResult, ForecastResult, GpResult, HmmResult, IForestResult, MlStats, MlToolId,
} from "@/lib/detective/ml";
import { num, pValue } from "./format";
import { I, MiniLine, MultiLine, Rows, Sig, Verdict, dot, type ToolInfo } from "./LabParts";

export const ML_TOOL_INFO: Record<MlToolId, ToolInfo> = {
  analog: {
    label: "相似", title: "相似期間搜尋（最近鄰＋DTW）",
    about: "在整段紀錄裡找出異常走勢最像這段的過去期間（最近鄰搜尋）。DTW（動態時間校正）允許時間稍微前後錯開再比較形狀。也看相似期間「之後」發生了什麼。",
    icon: I(<><path d="M3 14 C5 10 7 10 9 14" /><path d="M15 14 C17 10 19 10 21 14" /><path d="M9 18 H15" strokeDasharray="2 2" /></>),
  },
  hmm: {
    label: "狀態", title: "狀態模型（隱藏馬可夫模型）",
    about: "假設背後有 2–3 個看不見的「狀態」（偏乾／正常／偏濕），每個狀態會持續一陣子再切換。模型從資料學出各狀態的平均、持續時間，並估計每個月處在哪個狀態。",
    icon: I(<><circle cx="6" cy="12" r="3" /><circle cx="18" cy="12" r="3" /><path d="M9 10 C11 8 13 8 15 10 M15 14 C13 16 11 16 9 14" /></>),
  },
  forecast: {
    label: "預測", title: "預測 vs 實際（AR 模型）",
    about: "只用這段之前的資料訓練一個自我迴歸（AR）模型，預測這段期間「本來會怎樣」，再和實際比較：這件事是可預期的延續，還是真正的意外？",
    icon: I(<><path d="M3 15 L7 12 L10 13 L13 9" /><path d="M13 9 L21 7" strokeDasharray="2 2" /><path d="M13 9 L21 3 M13 9 L21 11" strokeWidth={1} /></>),
  },
  discord: {
    label: "罕見", title: "罕見片段搜尋（矩陣剖面）",
    about: "把這段裡每個 3、6、12 個月的片段，和整段紀錄所有其他片段比較。和誰都不像的片段是「最罕見」的；彼此幾乎一樣的兩段是「重複模式」。",
    icon: I(<><path d="M3 15 C5 13 6 13 8 15 S11 17 13 15" />{dot(17, 6)}<path d="M15 4 L19 8 M19 4 L15 8" /></>),
  },
  iforest: {
    label: "孤立林", title: "孤立森林（異常偵測）",
    about: "用每個月的異常、近 3 和 6 個月平均、近 6 個月起伏、和上月的差，建 200 棵隨機切割的樹。越容易被「孤立」出來的月份越異常。標出全紀錄最異常的 3%。",
    icon: I(<><path d="M7 20 V14 M7 14 L4 10 H10 Z" /><path d="M17 20 V13 M17 13 L14 9 H20 Z" />{dot(12, 5)}</>),
  },
  bocpd: {
    label: "貝氏", title: "貝氏轉折偵測（BOCPD）",
    about: "一邊讀資料一邊估計「目前這個狀態已經持續多久」。當新資料和目前狀態不合，就判斷可能換了狀態。可以找出多個轉折，並給出機率。",
    icon: I(<><path d="M3 16 H9 V9 H15 V14 H21" /><path d="M9 4 V7 M15 4 V7" strokeDasharray="1 2" /></>),
  },
  gp: {
    label: "平滑", title: "高斯過程平滑（GP）",
    about: "畫出一條平滑曲線並附 95% 不確定帶，平滑程度由資料自己決定（最大化邊際概似）。不確定帶整段在 0 以上或以下的期間，代表異常明確偏離正常。",
    icon: I(<><path d="M3 14 C7 6 11 6 13 12 C15 18 19 16 21 10" /><path d="M3 18 C7 10 11 10 13 16 C15 22 19 20 21 14" strokeDasharray="1.5 2.5" strokeWidth={1} /></>),
  },
};

export const isMlTool = (t: string): t is MlToolId => t in ML_TOOL_INFO;

const ym = (months: readonly string[], i: number) => months[i] ?? "—";
const span = (months: readonly string[], a: number, b: number) => `${ym(months, a)} → ${ym(months, b)}`;

export function MlResult({ s, unit, months }: { s: MlStats; unit: string; months: readonly string[] }) {
  switch (s.tool) {
    case "analog": return <AnalogBlock s={s} unit={unit} months={months} />;
    case "hmm": return <HmmBlock s={s} unit={unit} months={months} />;
    case "forecast": return <ForecastBlock s={s} unit={unit} months={months} />;
    case "discord": return <DiscordBlock s={s} unit={unit} months={months} />;
    case "iforest": return <IForestBlock s={s} unit={unit} months={months} />;
    case "bocpd": return <BocpdBlock s={s} unit={unit} months={months} />;
    case "gp": return <GpBlock s={s} unit={unit} months={months} />;
  }
}

type BlockProps<T> = { s: T; unit: string; months: readonly string[] };
const COLORS = ["var(--viz-warm)", "var(--focus)", "var(--viz-cool)"];

function AnalogBlock({ s, unit, months }: BlockProps<AnalogResult>) {
  const best = s.matches[0];
  return (
    <>
      <MultiLine x0={0} label="這段與最相似期間的異常走勢"
        lines={[...s.matches.map((m, k) => ({ ys: m.values, color: COLORS[k], width: 1.5, dashed: true })), { ys: s.query, color: "var(--ink)", width: 2.5 }]} />
      <p className="max-w-md text-xs text-ink-2">黑線：這段；虛線：相似期間 1–3（圖上以編號標出）。</p>
      <Rows rows={s.matches.map((m, k) => [
        `相似 ${k + 1}`,
        <span key={k}>{span(months, m.start, m.start + s.length - 1)} · 差距 {num(m.distance, 2)} {unit}{m.corr != null && ` · 形狀相關 ${num(m.corr, 2)}`}{m.after != null && ` · 之後 ${s.horizon} 個月平均 ${num(m.after, 2, true)}`}</span>,
      ] as [string, ReactNode])} />
      {s.dtw.length > 0 && (
        <p className="mt-1 text-ink-2">允許時間錯開（DTW）時最像：{s.dtw.map((m) => ym(months, m.start)).join("、")}。</p>
      )}
      <p className="mt-1 text-ink-2">一般候選期間的差距中位數為 {num(s.typical, 2)} {unit}。</p>
      <Verdict>
        {best.distance < s.typical / 2
          ? `最像的是 ${ym(months, best.start)} 開始的那段，差距只有一般的 ${Math.round((100 * best.distance) / s.typical)}%。`
          : "沒有特別像的過去期間：這段的走勢在紀錄裡相當獨特。"}
        {s.analogAfter != null && ` 相似期間之後 ${s.horizon} 個月平均為 ${num(s.analogAfter, 2, true)} ${unit}`}
        {s.analogAfter != null && s.actualAfter != null && `，這段之後實際是 ${num(s.actualAfter, 2, true)} ${unit}`}
        {s.analogAfter != null && "。"}
        {" "}相似不代表原因相同，要再查當時發生了什麼。
      </Verdict>
    </>
  );
}

const STATE_NAMES: Record<number, string[]> = { 2: ["偏低", "偏高"], 3: ["偏低", "正常", "偏高"] };

function HmmBlock({ s, unit, months }: BlockProps<HmmResult>) {
  const names = STATE_NAMES[s.K];
  return (
    <>
      <MultiLine x0={0} label="處在偏低與偏高狀態的機率"
        lines={[{ ys: s.pLow, color: "var(--viz-cool)" }, { ys: s.pHigh, color: "var(--viz-warm)" }]} height={80} />
      <p className="max-w-md text-xs text-ink-2">藍：處在「{names[0]}」狀態的機率；紅：處在「{names[s.K - 1]}」狀態的機率（0 到 1）。數線上以底色標出。</p>
      <Rows rows={[
        ...s.states.map((st, k) => [
          `狀態「${names[k]}」`,
          `平均 ${num(st.mean, 2, true)} ${unit}，標準差 ${num(st.sd, 2)}，佔 ${Math.round(st.share * 100)}% 的月份，平均持續 ${num(st.expectedDuration, 1)} 個月`,
        ] as [string, ReactNode]),
        ["最長偏低期", s.longestLow ? `${span(months, s.longestLow.from, s.longestLow.to)}（${s.longestLow.to - s.longestLow.from + 1} 個月）` : "—"],
        ["最長偏高期", s.longestHigh ? `${span(months, s.longestHigh.from, s.longestHigh.to)}（${s.longestHigh.to - s.longestHigh.from + 1} 個月）` : "—"],
        ["狀態數", `${s.K}（BIC：2 個 ${num(s.bic.k2, 0)}${s.bic.k3 != null ? `、3 個 ${num(s.bic.k3, 0)}` : ""}，越小越好）`],
      ]} />
      <Verdict>
        {s.longestLow
          ? `資料最長在「${names[0]}」狀態停留 ${s.longestLow.to - s.longestLow.from + 1} 個月（${span(months, s.longestLow.from, s.longestLow.to)}）。`
          : ""}
        {" "}狀態是模型從資料學出來的分組，不是官方的乾旱定義。
      </Verdict>
    </>
  );
}

function ForecastBlock({ s, unit, months }: BlockProps<ForecastResult>) {
  return (
    <>
      <MultiLine x0={0} label="預測與實際" band={{ lo: s.lo, hi: s.hi }}
        lines={[{ ys: s.forecast, color: "var(--ink-2)", dashed: true }, { ys: s.actual, color: "var(--viz-blue)", width: 2.5 }]} />
      <p className="max-w-md text-xs text-ink-2">藍：實際；虛線：預測；淺色帶：95% 預測區間。數線上也畫出預測線與區間。</p>
      <Rows rows={[
        ["模型", `AR(${s.p})，用 ${ym(months, s.start)} 之前的 ${s.trainN} 個月訓練；係數 ${s.coef.map((c) => num(c, 2, true)).join("、")}`],
        ["落在區間外", <b key="o">{s.outside}／{s.observed} 個月（隨機預期約 {num(s.observed * 0.05, 1)}）</b>],
        ["平均誤差（實際 − 預測）", `${num(s.meanError, 2, true)} ${unit}`],
        ["整段是否意外", <span key="p">z = {num(s.z, 2, true)}，p {pValue(s.pValue)} <Sig p={s.pValue} /></span>],
      ]} />
      <p className="mt-1 text-ink-2">預測越遠越不確定，所以區間會變寬；遠期的預測會回到長期平均。</p>
      <Verdict>
        {s.pValue < 0.05
          ? `實際值整體${s.meanError < 0 ? "低於" : "高於"}模型的預期，而且超出隨機誤差：從之前的資料看不出會這樣，是真正的意外。`
          : "實際情況大致在模型預期的範圍內：從之前的走勢看，這段並不特別意外。"}
      </Verdict>
    </>
  );
}

function DiscordBlock({ s, unit, months }: BlockProps<DiscordResult>) {
  return (
    <>
      {s.profile.length > 1 && (
        <>
          <MiniLine xs={s.profile.map((p) => p.x)} ys={s.profile.map((p) => p.d)} zero={false} label="每個片段和最像的另一段的差距" height={80} />
          <p className="max-w-md text-xs text-ink-2">矩陣剖面（{s.profileM} 個月片段）：越高代表這個片段越找不到相似的另一段。</p>
        </>
      )}
      <Rows rows={s.windows.map((w) => [
        `${w.m} 個月片段`,
        <span key={w.m}>
          {w.discord ? <>最罕見 <b>{span(months, w.discord.start, w.discord.start + w.m - 1)}</b>（差距 {num(w.discord.distance, 2)} {unit}，一般 {num(w.typical, 2)}）</> : "—"}
          {w.motif && <> · 最相似的一對 {ym(months, w.motif.a)} 與 {ym(months, w.motif.b)}</>}
        </span>,
      ] as [string, ReactNode])} />
      <Verdict>
        {(() => {
          const w = s.windows.find((q) => q.m === s.profileM) ?? s.windows[s.windows.length - 1];
          if (!w?.discord) return "片段太少，無法比較。";
          const ratio = w.discord.distance / w.typical;
          return `這段範圍裡最罕見的 ${w.m} 個月是 ${span(months, w.discord.start, w.discord.start + w.m - 1)}，和最像的另一段的差距是一般的 ${num(ratio, 1)} 倍${ratio > 2 ? "，相當獨特" : ""}。`;
        })()}
        {" "}這是搜尋工具，沒有 p 值。
      </Verdict>
    </>
  );
}

function IForestBlock({ s, unit, months }: BlockProps<IForestResult>) {
  return (
    <>
      <MiniLine xs={s.scores.map((_, k) => s.start + k).filter((_, k) => s.scores[k] != null)} ys={s.scores.filter((v): v is number => v != null)} zero={false} label="每個月的異常分數" height={80} />
      <p className="max-w-md text-xs text-ink-2">異常分數（0–1，越高越異常）；超過 {num(s.threshold, 2)}（全紀錄前 3%）的月份在數線上標出。</p>
      <Rows rows={s.flagged.length ? s.flagged.slice(0, 8).map((f) => [
        ym(months, f.x),
        `分數 ${num(f.score, 2)} · 當月 ${num(f.value, 2, true)} ${unit} · 近 6 個月平均 ${num(f.mean6, 2, true)}`,
      ] as [string, ReactNode]) : [["標出的月份", "這段範圍內沒有"]]} />
      <p className="mt-1 text-ink-2">{s.trees} 棵樹，每棵抽 {s.sample} 個月；用 {s.n} 個有完整前 6 個月資料的月份建模。</p>
      <Verdict>
        {s.flagged.length
          ? `這段範圍有 ${s.flagged.length} 個月被標為異常，最突出的是 ${ym(months, s.flagged[0].x)}。和只看 ±2σ 不同，它也會抓到「連續幾個月的組合」很不尋常的月份。`
          : "這段範圍沒有月份落在全紀錄最異常的 3%。"}
      </Verdict>
    </>
  );
}

function BocpdBlock({ s, unit, months }: BlockProps<BocpdResult>) {
  return (
    <>
      <MiniLine xs={s.prob.map((p) => p.x)} ys={s.prob.map((p) => p.p)} zero={false} label="每個月開始新狀態的機率" height={80} />
      <p className="max-w-md text-xs text-ink-2">每個月「從這裡開始新狀態」的機率（0–1）。數線上以階梯線畫出各段平均。</p>
      <Rows rows={[
        ["偵測到的轉折", s.changes.length ? s.changes.map((c) => `${ym(months, c.x)}（${Math.round(c.p * 100)}%）`).join("、") : "沒有"],
        ...s.segments.map((g, k) => [`第 ${k + 1} 段`, `${span(months, g.x0, g.x1)}，平均 ${num(g.mean, 2, true)} ${unit}`] as [string, ReactNode]),
      ]} />
      <p className="mt-1 text-ink-2">先驗：平均每 {s.hazard} 個月換一次狀態；百分比是「在該月前後一個月內換了狀態」的機率。</p>
      <Verdict>
        {s.changes.length
          ? `資料在 ${s.changes.map((c) => ym(months, c.x)).join("、")} 附近換了水準。和 Pettitt 不同，這裡可以有多個轉折。`
          : "沒有機率超過 50% 的轉折。"}
      </Verdict>
    </>
  );
}

/** The longest few spans, longest first, with a count of the rest. */
function listSpans(list: GpResult["spans"], months: readonly string[], max = 4): string {
  if (!list.length) return "—";
  const top = [...list].sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0)).slice(0, max);
  const text = top.map((p) => `${span(months, p.x0, p.x1)}（${p.x1 - p.x0 + 1} 個月）`).join("、");
  return list.length > max ? `${text} 等 ${list.length} 段` : text;
}

function GpBlock({ s, unit, months }: BlockProps<GpResult>) {
  return (
    <>
      <MultiLine x0={s.start} label="平滑曲線與 95% 不確定帶" band={{ lo: s.lo, hi: s.hi }}
        lines={[{ ys: s.mean, color: "var(--viz-blue)", width: 2.5 }]}
        spans={s.spans.map((p) => ({ x0: p.x0, x1: p.x1, color: p.sign > 0 ? "var(--viz-warm)" : "var(--viz-cool)" }))} />
      <p className="max-w-md text-xs text-ink-2">藍線：平滑後的異常；淺色帶：95% 不確定帶；紅／藍底：整個帶都在 0 以上／以下。</p>
      <Rows rows={[
        ["平滑尺度", `約 ${s.lengthScale} 個月（由資料在 6–48 個月中挑選）`],
        ["訊號占比", `${Math.round(s.signalShare * 100)}%（其餘視為逐月雜訊）`],
        ["明確偏高", listSpans(s.spans.filter((p) => p.sign > 0), months)],
        ["明確偏低", listSpans(s.spans.filter((p) => p.sign < 0), months)],
      ]} />
      <p className="mt-1 text-ink-2">用 {s.n} 個月擬合；單位 {unit}。不確定帶已包含平滑本身的不確定，但沒有考慮多段同時比較。</p>
      <Verdict>
        {s.spans.length
          ? `扣掉逐月雜訊後，有 ${s.spans.length} 段期間的異常明確偏離正常。`
          : "扣掉逐月雜訊後，平滑曲線的不確定帶都包含 0：沒有明確偏離正常的期間。"}
      </Verdict>
    </>
  );
}
