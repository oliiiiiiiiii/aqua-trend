"use client";
// Analysis lab, second set: trend shape (piecewise, permutation), spread (variance, calendar months),
// persistence and extremes (cumulative anomaly, streaks, extreme months) and cycles (periodogram).
import type { ReactNode } from "react";
import type {
  CusumResult, ExtremesResult, LabToolId, MonthlyResult, PermutationResult, PiecewiseResult, RunsResult, SpectrumResult, VarianceResult,
} from "@/lib/detective/lab";
import { num, pValue } from "./format";
import { Histogram, I, MiniLine, Rows, Sig, Verdict, dot, type ToolInfo } from "./LabParts";

type MoreTool = "piecewise" | "permutation" | "variance" | "monthly" | "cusum" | "runs" | "extremes" | "spectrum";

export const MORE_TOOL_INFO: Record<MoreTool, ToolInfo> = {
  piecewise: {
    label: "分段", title: "分段迴歸（兩段直線）",
    about: "用兩段相連的直線去擬合，自動找出「轉彎」的月份。適合「原本持平、某年後開始下降」這類變化；轉折點檢定只找跳階，這個找斜率改變。",
    icon: I(<><path d="M3 16 L12 15 L21 5" />{dot(12, 15)}</>),
  },
  permutation: {
    label: "置換", title: "置換檢定（打亂順序 2000 次）",
    about: "如果時間順序根本不重要，把月份打亂後也應該常常得到一樣陡的斜率。打亂 2000 次，看真實斜率排在哪裡。也示範「逐月打亂」和「整塊打亂」的差別。",
    icon: I(<><path d="M3 7 H8 L16 17 H21" /><path d="M3 17 H8 L16 7 H21" /><path d="M19 5 L21 7 L19 9 M19 15 L21 17 L19 19" /></>),
  },
  variance: {
    label: "變異", title: "變異比較（Brown–Forsythe）",
    about: "這段期間的起伏是不是比其他時候更大（或更小）？「越來越極端」常常比平均改變更重要。",
    icon: I(<><path d="M3 12 C5 11 6 13 8 12" /><path d="M11 12 C12 4 14 4 15 12 C16 20 18 20 19 12 L21 12" /></>),
  },
  monthly: {
    label: "月份", title: "逐月分解（Kruskal–Wallis）",
    about: "把異常依 1–12 月分組：事件只發生在某個季節嗎？Kruskal–Wallis 檢定判斷各月的異常是否有系統性差別。",
    icon: I(<><path d="M3 20 H21" /><path d="M5 20 V14 M8 20 V10 M11 20 V12 M14 20 V7 M17 20 V11 M20 20 V15" /></>),
  },
  cusum: {
    label: "累積", title: "累積異常（CUSUM）",
    about: "把每月異常一路加起來。乾旱時曲線會一路往下，下降的總量就是累積的「缺水量」；回升代表補回來。",
    icon: I(<><path d="M3 6 C7 6 8 8 10 11 C12 15 14 18 17 18 C19 18 20 16 21 14" /><path d="M3 21 H21" /></>),
  },
  runs: {
    label: "連續", title: "連續性（最長同號連續、runs test）",
    about: "連續幾個月都低於（或高於）正常？和「如果每月互相獨立」以及「依這個變數平常的持續性」各模擬 2000 次比較，看這麼長的連續有多罕見。",
    icon: I(<><path d="M3 12 H21" /><path d="M4 12 V8 M7 12 V9 M10 12 V16 M13 12 V17 M16 12 V16 M19 12 V18" /></>),
  },
  extremes: {
    label: "極端", title: "極端月份計數（二項檢定）",
    about: "這段期間有幾個月超過 ±2σ？和基準期的極端月份比例相比，是否多得不尋常？",
    icon: I(<><path d="M3 7 H21 M3 17 H21" strokeDasharray="2 3" /><path d="M6 12 V4 M10 12 V10 M14 12 V20 M18 12 V9" /></>),
  },
  spectrum: {
    label: "週期", title: "週期分析（Lomb–Scargle 週期圖）",
    about: "異常裡有沒有規律重複的週期？季節循環已經扣掉，若在 2–7 年附近有高峰，常和聖嬰／反聖嬰（ENSO）有關。虛線是紅噪音的 95% 門檻。",
    icon: I(<><path d="M3 18 C5 18 5 9 7 9 C9 9 9 18 11 18 C13 18 13 4 15 4 C17 4 17 18 19 18 L21 18" /></>),
  },
};

const ym = (months: readonly string[], i: number) => months[i] ?? "—";
const lenLabel = (m: number) => (m >= 24 ? `${num(m / 12, 1)} 年` : `${num(m, 1)} 個月`);

export function MoreResult({ s, unit, spanMonths, months }: {
  s: PiecewiseResult | PermutationResult | VarianceResult | MonthlyResult | CusumResult | RunsResult | ExtremesResult | SpectrumResult;
  unit: string;
  spanMonths: number;
  months: readonly string[];
}) {
  const su = spanMonths >= 120 ? { k: 120, label: "／十年" } : { k: 12, label: "／年" };
  switch (s.tool) {
    case "piecewise": return (
      <>
        <Rows rows={[
          ["轉彎月份", <b key="b">{ym(months, s.breakAt)}</b>],
          ["之前斜率", `${num(s.slopeBefore * su.k, 2, true)} ${unit}${su.label}`],
          ["之後斜率", `${num(s.slopeAfter * su.k, 2, true)} ${unit}${su.label}`],
          ["R²：一條線 → 兩段", `${num(s.r2Line, 2)} → ${num(s.r2Piecewise, 2)}`],
          ["F 檢定（兩段 vs 一條線）", <span key="p">F = {num(s.F, 2)}，p {pValue(s.p)} <Sig p={s.p} /></span>],
        ]} />
        <p className="mt-1 text-ink-2">已用有效樣本 {Math.round(s.nEff)}／{s.n} 修正自相關。轉彎月份是「試遍所有月份後挑最好的」，所以 p 值仍偏樂觀。</p>
        <Verdict>
          {s.p < 0.05
            ? `兩段直線明顯比一條直線好：${ym(months, s.breakAt)} 前後的變化速率不同。`
            : "兩段直線沒有比一條直線好多少，看不出可靠的轉彎。"}
        </Verdict>
      </>
    );
    case "permutation": return (
      <>
        <Histogram bins={s.hist.map((b) => ({ ...b, x0: b.x0 * su.k, x1: b.x1 * su.k }))} label="打亂後斜率的分布"
          marks={[{ at: 0, dashed: true, color: "var(--ink-3)" }, { at: s.slope * su.k, color: "var(--viz-warm)" }, { at: -s.slope * su.k, dashed: true, color: "var(--viz-warm)" }]} />
        <p className="max-w-md text-xs text-ink-2">長條：整塊打亂 {s.draws} 次得到的斜率；紅線：真實斜率（虛線為對稱的另一側）。</p>
        <Rows rows={[
          ["真實斜率", <b key="s">{num(s.slope * su.k, 2, true)} {unit}{su.label}</b>],
          ["逐月打亂 p", `${pValue(s.pNaive)}（假設每個月互相獨立）`],
          ["整塊打亂 p", <span key="p">{pValue(s.p)}（每塊 {s.block} 個月，保留持續性） <Sig p={s.p} /></span>],
        ]} />
        <Verdict>
          {s.p < 0.05
            ? "打亂順序後很少得到這麼陡的斜率：時間順序確實重要，有趨勢。"
            : "打亂順序後常常也得到這麼陡的斜率：這個斜率可能只是巧合。"}
          {s.pNaive < 0.05 && s.p >= 0.05 && " 注意逐月打亂會誤判為顯著——因為它忽略了相鄰月份本來就相似。"}
        </Verdict>
      </>
    );
    case "variance": return (
      <>
        <Rows rows={[
          ["這段標準差", `${num(s.a.sd, 2)} ${unit}（${s.a.n} 個月）`],
          ["其餘標準差", `${num(s.b.sd, 2)} ${unit}（${s.b.n} 個月）`],
          ["比值", <b key="r">{num(s.ratio, 2)} 倍</b>],
          ["Brown–Forsythe", <span key="p">t = {num(s.t, 2, true)}，df ≈ {num(s.df, 1)}，p {pValue(s.p)} <Sig p={s.p} /></span>],
        ]} />
        <p className="mt-1 text-ink-2">比較兩段「離中位數多遠」的平均，已修正自相關；不受極端值或非常態分布太大影響。</p>
        <Verdict>
          {s.p < 0.05
            ? `這段期間的起伏明顯${s.ratio > 1 ? "比較大：更容易出現極端月份" : "比較小：比平常穩定"}。`
            : "這段期間的起伏大小和其他時候差不多。"}
        </Verdict>
      </>
    );
    case "monthly": {
      const names = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
      const vals = s.byMonth.flatMap((g) => g.values);
      const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
      const W = 320, H = 110, sy = (v: number) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 20), col = W / 12;
      const strongest = s.byMonth.map((g, m) => ({ m, mean: g.mean })).filter((g) => Number.isFinite(g.mean)).sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean))[0];
      return (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block w-full max-w-md" style={{ height: H }} aria-label="各月份的異常">
            <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} style={{ stroke: "var(--ink-3)" }} />
            {s.byMonth.map((g, m) => (
              <g key={m}>
                {g.values.map((v, k) => <circle key={k} cx={col * (m + 0.5) + ((k % 5) - 2) * 2} cy={sy(v)} r={2} style={{ fill: v >= 0 ? "var(--viz-warm)" : "var(--viz-cool)", opacity: 0.6 }} />)}
                {Number.isFinite(g.mean) && <line x1={col * m + 4} x2={col * (m + 1) - 4} y1={sy(g.mean)} y2={sy(g.mean)} strokeWidth={2.5} style={{ stroke: "var(--ink)" }} />}
                <text x={col * (m + 0.5)} y={H - 2} textAnchor="middle" style={{ fill: "var(--ink-2)", fontSize: 10 }}>{names[m]}</text>
              </g>
            ))}
          </svg>
          <p className="max-w-md text-xs text-ink-2">點：每個月份的異常；黑線：該月平均。下方數字為月份。</p>
          <Rows rows={[
            ["偏離最大的月份", strongest ? `${strongest.m + 1} 月（平均 ${num(strongest.mean, 2, true)} ${unit}）` : "—"],
            ["Kruskal–Wallis", <span key="p">H = {num(s.H, 2)}，df = {s.df}，p {pValue(s.p)} <Sig p={s.p} /></span>],
          ]} />
          <Verdict>
            {s.p < 0.05
              ? "不同月份的異常明顯不同：這段期間的變化集中在某些季節。"
              : "各月份的異常沒有系統性差別，變化不集中在特定季節。"}
          </Verdict>
        </>
      );
    }
    case "cusum": {
      const xs = s.points.map((p) => p.x), cs = s.points.map((p) => p.c);
      const spans = [
        ...(s.deficit ? [{ x0: s.deficit.from, x1: s.deficit.to, color: "var(--viz-cool)" }] : []),
        ...(s.surplus ? [{ x0: s.surplus.from, x1: s.surplus.to, color: "var(--viz-warm)" }] : []),
      ];
      return (
        <>
          <MiniLine xs={xs} ys={cs} spans={spans} label="累積異常曲線" />
          <div className="flex max-w-md justify-between text-xs text-ink-2 tnum"><span>{ym(months, xs[0])}</span><span>藍底：最大累積虧損；紅底：最大累積盈餘</span><span>{ym(months, xs[xs.length - 1])}</span></div>
          <Rows rows={[
            ["整段累積", <b key="t">{num(s.total, 2, true)} {unit}（逐月相加）</b>],
            ["最大累積虧損", s.deficit ? `${num(-s.deficit.amount, 2, true)} ${unit}，${ym(months, s.deficit.from)} → ${ym(months, s.deficit.to)}（${s.deficit.to - s.deficit.from + 1} 個月）` : "—"],
            ["最大累積盈餘", s.surplus ? `${num(s.surplus.amount, 2, true)} ${unit}，${ym(months, s.surplus.from)} → ${ym(months, s.surplus.to)}（${s.surplus.to - s.surplus.from + 1} 個月）` : "—"],
          ]} />
          <Verdict>
            {s.deficit && (!s.surplus || s.deficit.amount >= s.surplus.amount)
              ? `最明顯的是一段持續 ${s.deficit.to - s.deficit.from + 1} 個月的累積虧損，總共比正常少 ${num(s.deficit.amount, 2)} ${unit}。`
              : s.surplus
                ? `最明顯的是一段持續 ${s.surplus.to - s.surplus.from + 1} 個月的累積盈餘，總共比正常多 ${num(s.surplus.amount, 2)} ${unit}。`
                : "沒有明顯的累積偏離。"}
            {" "}這是描述性工具，沒有 p 值；要檢定是否顯著，可用「連續」或「平均」。
          </Verdict>
        </>
      );
    }
    case "runs": {
      const side = s.longest.sign < 0 ? "低於" : "高於";
      return (
        <>
          <Rows rows={[
            ["最長連續", <b key="l">連續 {s.longest.length} 個月{side}正常（{ym(months, s.longest.from)} → {ym(months, s.longest.to)}）</b>],
            ["這段平均", `${num(s.longest.mean, 2, true)} ${unit}`],
            ["若每月獨立", `出現這麼長的機率 ${pValue(s.pIndependent)}`],
            ["依平常的持續性", <span key="pp">（lag-1 r = {num(s.rho, 2)}）機率 {pValue(s.pPersistent)} <Sig p={s.pPersistent} /></span>],
            ["Runs test", `${s.runs} 段（隨機預期 ${num(s.expectedRuns, 1)}），z = ${num(s.z, 2, true)}，p ${pValue(s.p)}`],
          ]} />
          <p className="mt-1 text-ink-2">「依平常的持續性」用整段資料的 lag-1 相關模擬 2000 次，比「每月獨立」更公平。Runs test 段數太少代表高低會成群出現。</p>
          <Verdict>
            {s.pPersistent < 0.05
              ? `即使考慮這個變數本來就會延續，連續 ${s.longest.length} 個月${side}正常仍然罕見。`
              : s.pIndependent < 0.05
                ? `這麼長的連續看似罕見，但這個變數本來就有很強的延續性，所以並不意外。`
                : "這麼長的連續在隨機情況下也常出現。"}
          </Verdict>
        </>
      );
    }
    case "extremes": return (
      <>
        <Rows rows={[
          ["超過 +2σ", `${s.high} 個月`],
          ["低於 −2σ", `${s.low} 個月`],
          ["合計", <b key="c">{s.count}／{s.n} 個月（{num((100 * s.count) / s.n, 1)}%）</b>],
          ["基準期比例", `${num(100 * s.rate, 1)}%，預期約 ${num(s.expected, 1)} 個月`],
          ["二項檢定", <span key="p">p {pValue(s.p)}（雙尾）· 「偏多」單尾 p {pValue(s.pUpper)} <Sig p={s.p} /></span>],
        ]} />
        <p className="mt-1 text-ink-2">未修正自相關：極端月份常常連在一起出現，p 值偏樂觀。</p>
        <Verdict>
          {s.p < 0.05
            ? s.count > s.expected ? "這段期間的極端月份明顯比平常多。" : "這段期間的極端月份明顯比平常少。"
            : "極端月份的數量在正常範圍內。"}
        </Verdict>
      </>
    );
    case "spectrum": {
      const periods = s.freq.map((f) => 1 / f);
      const top = s.peaks[0];
      return (
        <>
          <MiniLine xs={periods} ys={s.power} ys2={s.threshold} logX zero={false} label="週期圖" />
          <div className="flex max-w-md justify-between text-xs text-ink-2 tnum"><span>{lenLabel(periods[0])}</span><span>藍：強度；虛線：紅噪音 95% 門檻</span><span>{lenLabel(periods[periods.length - 1])}</span></div>
          <Rows rows={s.peaks.map((pk, k) => [
            `第 ${k + 1} 高峰`,
            <span key={k}>週期 {lenLabel(pk.period)}，強度 {num(pk.power, 1)}（門檻 {num(pk.threshold, 1)}） <Sig p={pk.significant ? 0 : 1} /></span>,
          ] as [string, ReactNode])} />
          <p className="mt-1 text-ink-2">紅噪音背景以 lag-1 r = {num(s.rho, 2)} 計算。同時看很多週期，偶爾會有一個剛好越過門檻，單一高峰要謹慎解讀。</p>
          <Verdict>
            {top?.significant
              ? `最明顯的週期約 ${lenLabel(top.period)}${top.period >= 24 && top.period <= 84 ? "，落在聖嬰／反聖嬰（ENSO）常見的 2–7 年範圍" : ""}。`
              : "沒有週期明顯超過紅噪音背景：起伏看起來沒有固定節奏。"}
          </Verdict>
        </>
      );
    }
  }
}

export const isMoreTool = (t: LabToolId): t is MoreTool => t in MORE_TOOL_INFO;
