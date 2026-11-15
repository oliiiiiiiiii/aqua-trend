// Summary, variable set and warnings of a result (spec §9 items 3 and 7; acceptance S03, S04).
import { itemStatusLabel, ROLE_HELP, ROLE_LABEL, ROLE_ORDER, short } from "@/lib/research/format";
import type { ResearchResult } from "@/lib/research/types";
import { Card, ItemStatusPill, Notice, RefList } from "./ui";

/** result.summary statements, or "explanation unavailable" while the numbers stay (data contract §9.4). */
export function SummaryPanel({ result }: { result: ResearchResult }) {
  const s = result.summary;
  return (
    <Card aria-labelledby="summary-h" data-testid="summary">
      <h2 id="summary-h" className="text-2xl">Summary</h2>
      {s && s.status === "ok" && s.statements.length > 0 ? (
        <>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink marker:text-ink-3">
            {s.statements.map((st) => (
              <li key={st.text} className="max-w-[80ch]">
                {st.text}
                {st.evidence_ids.length > 0 && (
                  <span className="ml-1 text-[0.8125rem] text-ink-3" title={st.evidence_ids.join(", ")}>
                    [evidence {st.evidence_ids.map((id) => short(id, 8)).join(", ")}]
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 max-w-[80ch] text-[0.8125rem] text-ink-3">
            Each sentence restates numbers computed by the analysis and points to its evidence. A trend in a related variable is not proof of a cause.
          </p>
        </>
      ) : (
        <Notice tone="warn" role="status" className="mt-2">
          <span className="font-semibold text-ink">The written explanation is unavailable.</span>{" "}
          {s?.unavailable_reason ?? "No summary was produced for this result."} The numbers, charts and tables below are complete without it.
        </Notice>
      )}
    </Card>
  );
}

/** Variable set grouped by role, with the reason and the catalogue references of each choice. */
export function VariableSetPanel({ result }: { result: ResearchResult }) {
  const sel = result.selection;
  const byId = new Map(result.variables.map((v) => [v.variable_id, v]));
  const ids = sel ? sel.variable_set.map((v) => v.variable_id) : result.variables.map((v) => v.variable_id);
  return (
    <Card aria-labelledby="varset-h" data-testid="variable-set">
      <h2 id="varset-h" className="text-2xl">Variables selected for this phenomenon</h2>
      <Notice tone="info" className="mt-2">
        <span className="font-semibold text-ink">Roles describe why a variable was chosen, not what the data proved.</span>{" "}
        A role comes from the offline catalogue. A trend in a “related condition” or a “possible response” does not show that it causes, or is caused by, the phenomenon.
      </Notice>
      {sel?.status === "unsupported_phenomenon" && (
        <Notice tone="warn" role="status" className="mt-3">
          <span className="font-semibold text-ink">The catalogue has no documented variable for this phenomenon.</span>{" "}
          Nothing unrelated was added to produce an answer. Try a different description, or see what the catalogue covers on the Data page.
        </Notice>
      )}
      {sel?.status === "partial" && (
        <Notice tone="warn" role="status" className="mt-3">
          Only part of this phenomenon can be addressed with the catalogue. The list under “Conditions used” says what cannot be answered.
        </Notice>
      )}
      {ids.length === 0 ? (
        <p className="mt-3 text-ink-2">No variable was selected.</p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          {ROLE_ORDER.map((role) => {
            const members = ids.filter((id) => (byId.get(id)?.role ?? sel?.variable_set.find((v) => v.variable_id === id)?.role) === role);
            return (
              <div key={role} data-role={role}>
                <h3 className="text-base">{ROLE_LABEL[role]} <span className="font-normal text-ink-3">({members.length})</span></h3>
                <p className="text-[0.8125rem] text-ink-3">{ROLE_HELP[role]}</p>
                {members.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-2">None selected.</p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {members.map((id) => {
                      const v = byId.get(id);
                      const planned = sel?.variable_set.find((x) => x.variable_id === id);
                      return (
                        <li key={id} className="border-l-2 border-line pl-3">
                          <p className="flex flex-wrap items-center gap-2">
                            {v ? <a href={`#var-${id}`} className="font-semibold text-link underline underline-offset-2">{v.label}</a> : <span className="font-semibold">{id}</span>}
                            {v && v.status !== "ok" && <ItemStatusPill status={v.status} />}
                          </p>
                          <p className="mt-0.5 text-sm text-ink-2">{v?.reason ?? planned?.reason}</p>
                          {v && v.status !== "ok" && <p className="mt-0.5 text-sm text-ink-2">{itemStatusLabel(v.status)}: {v.status_reason ?? "no reason given"}</p>}
                          {!v && <p className="mt-0.5 text-sm text-ink-2">Selected, but the result contains no block for it.</p>}
                          {v && v.catalogue_refs.length > 0 ? (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[0.8125rem] font-semibold text-link">References ({v.catalogue_refs.length})</summary>
                              <div className="mt-1"><RefList refs={v.catalogue_refs} /></div>
                            </details>
                          ) : planned && planned.catalogue_refs.length > 0 ? (
                            <p className="mt-0.5 text-[0.8125rem] text-ink-3">Catalogue references: {planned.catalogue_refs.join(", ")}</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Data / baseline / method shortfalls and partial-result notes of the whole result. */
export function WarningsPanel({ result }: { result: ResearchResult }) {
  if (!result.warnings.length) return null;
  const names = new Map<string, string>([
    ...result.variables.map((v) => [v.variable_id, v.label] as [string, string]),
    ...result.indicators.map((i) => [i.indicator_id, i.label] as [string, string]),
  ]);
  return (
    <Card aria-labelledby="warnings-h" data-testid="warnings">
      <h2 id="warnings-h" className="text-2xl">Notes and shortfalls</h2>
      <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
        {result.warnings.map((w, i) => (
          <li key={`${w.code}-${i}`} className="max-w-[90ch] border-l-4 pl-3" style={{ borderColor: "var(--status-warning)" }}>
            {w.subject ? <span className="font-semibold text-ink">{names.get(w.subject) ?? w.subject}: </span> : null}
            {w.message} <code className="text-[0.8125rem] text-ink-3">{w.code}</code>
          </li>
        ))}
      </ul>
    </Card>
  );
}
