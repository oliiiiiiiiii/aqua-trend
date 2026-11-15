// 關鍵字表與時間解析的快速檢查：node tools/selector/check-keywords.mts（Node 22.6+ 會自動剝除型別）
import { suggestedTime, keywordSelect, matchedRules } from "../../web/lib/detective/keywords.ts";
const cases: [string, string|null][] = [
 ["2021 台灣春季大旱","2021-03..2021-05"],
 ["2021 年 2 月到 5 月台灣乾旱","2021-02..2021-05"],
 ["2021年2-5月台灣乾旱","2021-02..2021-05"],
 ["2020 年 11 月至 2021 年 2 月","2020-11..2021-02"],
 ["2021 年 8 月","2021-08..2021-08"],
 ["2021年十月颱風","2021-10..2021-10"],
 ["2021-02..2021-05 drought","2021-02..2021-05"],
 ["2021-02 to 2021-05","2021-02..2021-05"],
 ["2022/07 Pakistan floods","2022-07..2022-07"],
 ["Pakistan floods July 2022","2022-07..2022-07"],
 ["Feb–May 2021 drought","2021-02..2021-05"],
 ["Nov 2020 to Feb 2021 cold","2020-11..2021-02"],
 ["2022 August floods","2022-08..2022-08"],
 ["2019–20 Australian bushfires","2019-01..2020-12"],
 ["2019-2020 fires","2019-01..2020-12"],
 ["2019–20 澳洲黑色夏季","2019-01..2020-12"],
 ["2022 Pakistan floods","2022-01..2022-12"],
 ["Texas winter storm 2021","2020-12..2021-02"],
 ["夏威夷 2023 野火","2023-01..2023-12"],
 ["Amazon drought","null"],
 ["b4-4040046370 drought","null"],
 ["El Niño 2015 to 2016","2015-01..2016-12"],
 ["2011-12 drought","2011-12..2011-12"],
 ["２０２１年２月","2021-02..2021-02"],
];
let bad=0;
for (const [e, want] of cases) { const r=suggestedTime(e); const got=r?`${r.start}..${r.end}`:"null"; if(got!==want){bad++;console.log("FAIL",e,got,"want",want);} }
console.log("time cases", cases.length, "fail", bad);
if (bad) process.exitCode = 1;
for (const e of ["2021 台灣春季大旱","2022 Pakistan floods","El Niño 2015","Hawaii 2023 wildfire","something unrelated","2021 Texas winter storm","颱風季 2024"]) {
  const r=keywordSelect(e); console.log(e, matchedRules(e).join(","), "=>", r.votes.filter(v=>v.selected).map(v=>v.category).join(","));
}
