"use client";
// Research inputs (spec §2, §3.2, §9 item 1; acceptance P01–P04, S05, D01, D02): free-text phenomenon, ONE
// region from the existing catalogue, an OPTIONAL period (both months or neither), and "Start exploring".
// The text never sets place or time; the selectors do, and each can be cleared.
import { useId } from "react";
import { LAYER_LABEL } from "@/lib/data";
import { formatArea } from "@/components/explore/regionUtils";
import { API_BASE } from "@/lib/research/api";
import { RegionFinder } from "./RegionFinder";
import type { ResearchState } from "./useResearch";
import { btnPrimary, btnQuiet, Notice, Pill } from "./ui";

const MAX_CHIPS = 10;

export function InputPanel({ state }: { state: ResearchState }) {
  const id = useId();
  const { form, fieldErrors, region, availability, backend } = state;
  const periodFilled = form.from.trim() !== "" || form.to.trim() !== "";
  const chips = state.phenomena.slice(0, MAX_CHIPS);

  return (
    <form
      className="rounded-card bg-paper p-5 text-ink shadow-card sm:p-6"
      aria-labelledby={`${id}-h`}
      noValidate
      onSubmit={(e) => { e.preventDefault(); state.start(); }}
      data-testid="research-form"
    >
      <h1 id={`${id}-h`} className="text-[1.75rem]">Explore a phenomenon</h1>
      <p className="mt-1 text-ink-2">
        Describe an Earth-system phenomenon. The system picks related variables from its catalogue, analyses their trends in one region, and reports what the data do and do not support.
      </p>

      {/* ---------------------------------------------------------- phenomenon */}
      <div className="mt-5">
        <label htmlFor={`${id}-q`} className="block font-semibold">Phenomenon</label>
        <p id={`${id}-q-hint`} className="text-sm text-ink-3">Any phenomenon, in English or 中文. What can be analysed depends on the prepared data.</p>
        <input
          id={`${id}-q`}
          name="q"
          type="text"
          autoComplete="off"
          value={form.q}
          onChange={(e) => state.setQuery(e.target.value)}
          aria-describedby={`${id}-q-hint ${id}-q-note${fieldErrors.q ? ` ${id}-q-err` : ""}`}
          aria-invalid={fieldErrors.q ? true : undefined}
          placeholder="e.g. drought, 乾旱, snowpack decline"
          className="mt-2 w-full rounded-ctl border border-line bg-paper px-4 py-2.5 text-ink placeholder:text-ink-3"
        />
        {fieldErrors.q && <p id={`${id}-q-err`} role="alert" className="mt-1.5 text-sm font-semibold text-ink" data-testid="q-error"><span aria-hidden="true">! </span>{fieldErrors.q}</p>}
        {chips.length > 0 && (
          <div className="mt-2">
            <p className="text-[0.8125rem] text-ink-3">Phenomena described in the catalogue (examples, not a limit on what you can type):</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {chips.map((p) => (
                <li key={p.phenomenon_id}>
                  <button type="button" onClick={() => state.setQuery(p.label)} className="rounded-ctl border border-line px-2.5 py-0.5 text-[0.8125rem] text-ink-2 hover:bg-well">
                    {p.label}{p.label_zh ? <span lang="zh-Hant" className="text-ink-3"> {p.label_zh}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Notice tone="info" className="mt-3">
          <span id={`${id}-q-note`} data-testid="selector-note">
            <span className="font-semibold text-ink">Place and time come from the selectors below, not from this text.</span>{" "}
            A place name or a year typed here is read as part of the description and does not set the region or the period.
          </span>
        </Notice>
      </div>

      {/* ---------------------------------------------------------- region */}
      <fieldset className="mt-6 border-t border-line pt-5">
        <legend className="float-left w-full font-semibold">Region <span className="font-normal text-ink-3">(optional, one at a time)</span></legend>
        <div className="clear-both pt-1">
          {region ? (
            <div data-testid="chosen-region" data-region={region.id}>
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold">{region.name}</span>
                <Pill tone="real"><span aria-hidden="true">✓</span> You chose</Pill>
              </p>
              <p className="text-sm text-ink-3">{LAYER_LABEL[region.type]}, {formatArea(region.areaKm2)} · <code>{region.id}</code></p>
              <div role="status" className="mt-1.5 text-sm" data-testid="region-availability" data-state={availability.state === "known" ? (availability.region.series_available ? "available" : "no_series") : availability.state}>
                {availability.state === "checking" && <span className="text-ink-3">Checking whether this region has a prepared series…</span>}
                {availability.state === "known" && availability.region.series_available !== false && (
                  <span className="text-ink-2">
                    Prepared series are available for this region{typeof availability.region.n_products === "number" ? ` (${availability.region.n_products} data products)` : ""}.
                  </span>
                )}
                {availability.state === "known" && availability.region.series_available === false && (
                  <Notice tone="warn">
                    <span className="font-semibold text-ink">This region has a boundary but no prepared series.</span>{" "}
                    You can still choose it. The result will say that data is missing here; it will not use a parent or neighbouring region instead.
                  </Notice>
                )}
                {availability.state === "unknown" && (
                  <span className="text-ink-3">Whether this region has a prepared series could not be checked ({availability.message})</span>
                )}
              </div>
              <button type="button" className={`${btnQuiet} mt-2`} onClick={state.clearRegion} data-testid="clear-region">Clear region</button>
            </div>
          ) : (
            <p className="text-sm text-ink-2" data-testid="no-region">
              No region chosen. A preset will suggest one that fits the phenomenon{periodFilled ? " and your period" : ""}.
            </p>
          )}
          {state.unknownRegionId && (
            <Notice tone="warn" role="status" className="mt-2">
              The link asked for a region called “{state.unknownRegionId}”, which is not in the region catalogue.{" "}
              <button type="button" className="text-link underline underline-offset-2" onClick={state.clearRegion}>Clear it</button> or choose another one.
            </Notice>
          )}
          {fieldErrors.region && <p role="alert" className="mt-1.5 text-sm font-semibold"><span aria-hidden="true">! </span>{fieldErrors.region}</p>}
          <div className="mt-3">
            {state.catalog ? (
              <RegionFinder catalog={state.catalog} onSelect={state.selectRegion} />
            ) : state.catalogStatus === "error" ? (
              <p role="alert" className="rounded-ctl bg-well px-4 py-2.5 text-sm text-ink-2">The region catalogue did not load, so regions cannot be searched. Reload the page to try again.</p>
            ) : (
              <p role="status" className="rounded-ctl bg-well px-4 py-2.5 text-sm text-ink-3">Loading the region catalogue…</p>
            )}
          </div>
          <p className="mt-2 text-sm text-ink-3">
            Or click a region on <a href="#research-globe" className="text-link underline underline-offset-2">the globe</a>. Both ways select the same catalogue regions.
          </p>
        </div>
      </fieldset>

      {/* ---------------------------------------------------------- period */}
      <fieldset className="mt-6 border-t border-line pt-5" aria-describedby={`${id}-p-hint${fieldErrors.period ? ` ${id}-p-err` : ""}`}>
        <legend className="float-left w-full font-semibold">Analysis period <span className="font-normal text-ink-3">(optional)</span></legend>
        <div className="clear-both pt-1">
          <p id={`${id}-p-hint`} className="text-sm text-ink-3">
            First and last month, both included. Give both or neither. Left empty, a preset suggests a period. You can also select a period on a chart later.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-sm text-ink-2">
              From (YYYY-MM)
              <input
                name="from"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="YYYY-MM"
                maxLength={7}
                value={form.from}
                onChange={(e) => state.setPeriodField("from", e.target.value)}
                aria-invalid={fieldErrors.period ? true : undefined}
                className="mt-1 w-32 rounded-ctl border border-line bg-paper px-3 py-2 text-ink tnum placeholder:text-ink-3"
              />
            </label>
            <label className="flex flex-col text-sm text-ink-2">
              To (YYYY-MM)
              <input
                name="to"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="YYYY-MM"
                maxLength={7}
                value={form.to}
                onChange={(e) => state.setPeriodField("to", e.target.value)}
                aria-invalid={fieldErrors.period ? true : undefined}
                className="mt-1 w-32 rounded-ctl border border-line bg-paper px-3 py-2 text-ink tnum placeholder:text-ink-3"
              />
            </label>
            {periodFilled && (
              <button type="button" className={btnQuiet} onClick={state.clearPeriod} data-testid="clear-period">Clear period</button>
            )}
          </div>
          {fieldErrors.period && (
            <p id={`${id}-p-err`} role="alert" className="mt-2 border-l-4 py-1 pl-3 text-sm font-semibold text-ink" style={{ borderColor: "var(--status-critical)" }} data-testid="period-error">
              <span aria-hidden="true">! </span>{fieldErrors.period}
            </p>
          )}
          {!periodFilled && <p className="mt-2 text-sm text-ink-2">No period chosen. A preset will suggest one.</p>}
        </div>
      </fieldset>

      {/* ---------------------------------------------------------- start */}
      <div className="mt-6 border-t border-line pt-5">
        {backend.state === "down" && (
          <Notice tone="error" role="status" className="mb-3">
            <span data-testid="backend-down">
              <span className="font-semibold text-ink">The analysis service is not reachable at {API_BASE}.</span>{" "}
              Nothing can be computed until it runs; no example numbers are shown instead. Your inputs are kept.{" "}
              <button type="button" className="text-link underline underline-offset-2" onClick={state.recheckBackend}>Check again</button>
            </span>
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="submit" className={btnPrimary} data-testid="start">Start exploring</button>
          <p className="text-sm text-ink-3">
            {state.busy ? "An analysis is running. Starting again replaces it." : "The analysis runs on its own; you do not need to confirm a plan."}
          </p>
        </div>
      </div>
    </form>
  );
}
