// 三個預設事件（工作線 E）。規格：/SPEC.md §5。
// 每個事件都已用 tools/validate_presets.py 對 series-2 重算殘差與 z，
// 至少一個預設資料層 |z| ≥ 2 且方向符合 expected；數值見 /docs/presets-validation.md。
// expected 是給學生看的「假說」：有些類別（例如巴基斯坦的 tws）資料上不顯著，
// 刻意保留，讓畫面呈現假說 ✗ 的情況。

import type { PresetEvent } from "./contracts";

export const PRESET_EVENTS: PresetEvent[] = [
  {
    id: "taiwan-2021-drought",
    title: "2021 台灣春季大旱",
    event: "2021 台灣春季大旱",
    blurb:
      "2020 年是 1964 年以來第一次沒有颱風登陸台灣，秋冬到春天又少雨；2021 年 4–5 月水庫見底，中部實施分區供水。",
    time: { start: "2021-04", end: "2021-05" },
    region: "b4-4040046370",
    categories: ["precip", "soil", "tws", "ndvi"],
    padMonths: 12,
    active: "soil",
    expected: { precip: "low", soil: "low", tws: "low", ndvi: "low" },
  },
  {
    id: "pakistan-2022-flood",
    title: "2022 巴基斯坦洪水",
    event: "2022 巴基斯坦洪水",
    blurb:
      "2022 年 7–9 月季風帶來破紀錄的雨量，印度河流域大範圍氾濫，約三分之一國土被淹，超過 3,000 萬人受災。",
    time: { start: "2022-07", end: "2022-09" },
    region: "b4-4040879050",
    categories: ["precip", "runoff", "soil", "tws"],
    padMonths: 12,
    active: "precip",
    expected: { precip: "high", runoff: "high", soil: "high", tws: "high" },
  },
  {
    id: "australia-2019-fire",
    title: "2019–20 澳洲黑色夏季",
    event: "2019–20 澳洲黑色夏季（乾旱與野火）",
    blurb:
      "2019 年是澳洲有紀錄以來最熱也最乾的一年；9 月到隔年 1 月，東南部森林大火延燒，燒毀上千萬公頃土地。",
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
