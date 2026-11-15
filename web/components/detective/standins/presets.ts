// STAND-IN for workstream E (web/lib/detective/presets.ts). The three events of SPEC §5; delete at integration.
import type { PresetEvent } from "@/lib/detective/contracts";

export const STANDIN_PRESETS: PresetEvent[] = [
  {
    id: "taiwan-2021-drought",
    title: "2021 Taiwan spring drought",
    blurb: "No typhoon made landfall in 2020 and the spring rains failed, so reservoirs ran nearly dry by May 2021.",
    event: "2021 Taiwan spring drought",
    time: { start: "2021-02", end: "2021-05" },
    region: "b4-4040046370",
    categories: ["precip", "soil", "tws", "ndvi"],
    expected: { precip: "low", soil: "low", tws: "low", ndvi: "low" },
  },
  {
    id: "pakistan-2022-flood",
    title: "2022 Pakistan floods",
    blurb: "Record monsoon rain in July–September 2022 put about a third of Pakistan under water.",
    event: "2022 Pakistan floods",
    time: { start: "2022-07", end: "2022-09" },
    region: "b4-4040879050",
    categories: ["precip", "runoff", "soil", "tws"],
    expected: { precip: "high", runoff: "high", soil: "high", tws: "high" },
  },
  {
    id: "australia-2019-fire",
    title: "2019–20 Australian Black Summer",
    blurb: "After a record dry, hot 2019, bushfires burned across south-east Australia from September 2019 to January 2020.",
    event: "2019–20 Australian Black Summer drought and bushfires",
    time: { start: "2019-09", end: "2020-01" },
    region: "b4-5040070710",
    categories: ["precip", "soil", "tair", "ndvi"],
    expected: { precip: "low", soil: "low", tair: "high", ndvi: "low" },
  },
];
