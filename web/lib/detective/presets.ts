// 三個預設事件（工作線 E）。規格：/SPEC.md §5。
// 已用 tools/validate_presets.py 對 series-2 重算殘差與 z；數值見 /docs/presets-validation.md。
// 台灣保留原訂 2–5 月，尚未達 |z| ≥ 2；巴基斯坦、澳洲有預設資料層通過。
// expected 是給學生看的「假說」：有些類別（例如巴基斯坦的 tws）資料上不顯著，
// 刻意保留，讓畫面呈現假說 ✗ 的情況。

import type { PresetEvent } from "./contracts";

export const PRESET_EVENTS: PresetEvent[] = [
  {
    id: "taiwan-2021-drought",
    title: "2021 Taiwan spring drought",
    event: "2021 Taiwan spring drought",
    blurb: "No typhoon made landfall in 2020, then a dry winter; reservoirs ran very low by April–May 2021 and central Taiwan rationed water.",
    time: { start: "2021-02", end: "2021-05" },
    region: "b4-4040046370",
    categories: ["precip", "soil", "tws", "ndvi"],
    padMonths: 12,
    active: "soil",
    expected: { precip: "low", soil: "low", tws: "low", ndvi: "low" },
  },
  {
    id: "pakistan-2022-flood",
    title: "2022 Pakistan floods",
    event: "2022 Pakistan floods",
    blurb: "Record monsoon rain from July to September flooded the Indus basin; about a third of the country was under water.",
    time: { start: "2022-07", end: "2022-09" },
    region: "b4-4040879050",
    categories: ["precip", "runoff", "soil", "tws"],
    padMonths: 12,
    active: "precip",
    expected: { precip: "high", runoff: "high", soil: "high", tws: "high" },
  },
  {
    id: "australia-2019-fire",
    title: "2019–20 Australian Black Summer",
    event: "2019–20 Australian Black Summer (drought and bushfires)",
    blurb: "The hottest and driest year on record in Australia, followed by bushfires across the south-east from September to January.",
    time: { start: "2019-09", end: "2020-01" },
    region: "b4-5040070710",
    categories: ["precip", "soil", "tair", "ndvi"],
    padMonths: 12,
    active: "soil",
    expected: { precip: "low", soil: "low", tair: "high", ndvi: "low" },
  },
];

export function getPreset(id: string): PresetEvent | undefined {
  return PRESET_EVENTS.find((p) => p.id === id);
}
