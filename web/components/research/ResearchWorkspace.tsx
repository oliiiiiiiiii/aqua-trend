"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { GlobePane, type PickableLayer } from "@/components/explore/GlobePane";
import { RegionSearch } from "@/components/explore/RegionSearch";
import { RegionDialog } from "@/components/explore/RegionDialog";
import { FEATURED_SHORT } from "@/components/shell/featured";
import { useMediaQuery } from "@/components/explore/hooks";
import { loadCatalog, pickRegions } from "@/lib/data";
import type { Catalog, Region } from "@/lib/types";
import {
  errorDetail,
  periodText,
  researchApi,
  validateMonths,
  words,
  type Period,
  type Preset,
  type PresetRef,
  type ResearchCatalogue,
  type ResearchRequest,
} from "@/lib/research";
import { MonthField } from "./MonthField";
import { RecordDetails, StudyResults } from "./StudyResults";
import { useResearchJob } from "./useResearchJob";

interface SavedStudy {
  id: string;
  title: string;
  region: string;
  period: string;
}
const historyKey = "aqua-trend-research-history-v1";
const emptyMonths = { start: "", end: "" };
function readStudies(): SavedStudy[] {
  try {
    const rows = JSON.parse(localStorage.getItem(historyKey) ?? "[]");
    return Array.isArray(rows)
      ? rows.filter((r) => typeof r?.id === "string" && typeof r.title === "string")
      : [];
  } catch {
    return [];
  }
}

export default function ResearchWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const linkedStudy = params.get("research");
  const initialRegion = params.get("region");
  const [phenomenon, setPhenomenon] = useState("");
  const [regionId, setRegionId] = useState<string | null>(initialRegion);
  const [months, setMonths] = useState<Period>(emptyMonths);
  const [validation, setValidation] = useState("");
  const [geo, setGeo] = useState<Catalog | null>(null);
  const [catalogue, setCatalogue] = useState<ResearchCatalogue | null>(null);
  const [geoFailure, setGeoFailure] = useState("");
  const [apiFailure, setApiFailure] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [history, setHistory] = useState<SavedStudy[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [showGlobe, setShowGlobe] = useState(false);
  const wide = useMediaQuery("(min-width: 900px)");
  const [layer, setLayer] = useState<PickableLayer>("basin3");
  const automaticLayer = useRef(true);
  const [pickStatus, setPickStatus] = useState("");
  const [overlap, setOverlap] = useState<Region[]>([]);
  const pickToken = useRef(0);
  const parentId = useRef<string | null>(null);
  const boundPreset = useRef<PresetRef | null>(null);
  const appliedId = useRef<string | null>(null);
  const currentRequest = useRef<ResearchRequest | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const { job, busy, error, start, retry, cancel, discard } = useResearchJob();
  const result = job?.result;
  const selected = geo?.byId.get(regionId ?? "") ?? null;
  const regionAvailability = catalogue?.regions.find((r) => r.id === regionId);
  const [currentPreset, setCurrentPreset] = useState<Preset | null>(null);

  useEffect(() => {
    let live = true;
    setGeoFailure("");
    setApiFailure("");
    loadCatalog().then(
      (data) => {
        if (live) setGeo(data);
      },
      (cause) => {
        if (live) setGeoFailure(errorDetail(cause).message);
      },
    );
    researchApi<ResearchCatalogue>("/api/catalogue").then(
      (data) => {
        if (live) setCatalogue(data);
      },
      (cause) => {
        if (live) setApiFailure(errorDetail(cause).message);
      },
    );
    return () => {
      live = false;
    };
  }, [loadAttempt]);
  useEffect(() => {
    setHistory(readStudies());
  }, []);
  useEffect(() => {
    if (linkedStudy) {
      currentRequest.current = null;
      appliedId.current = null;
      void start({ id: linkedStudy });
    }
  }, [linkedStudy, start]);
  useEffect(() => {
    if (!result || appliedId.current === result.identity.id) return;
    appliedId.current = result.identity.id;
    parentId.current = result.identity.id;
    boundPreset.current = result.resolved?.preset ?? null;
    setCurrentPreset(result.resolved?.preset ?? null);
    const user = result.user_constraints;
    if (user) {
      setPhenomenon(user.phenomenon_query ?? currentRequest.current?.phenomenon_query ?? "");
      setRegionId(user.region_id ?? null);
      setMonths(user.period ?? emptyMonths);
    }
    const entry = {
      id: result.identity.id,
      title: result.selection?.phenomenon || user?.phenomenon_query || "Study",
      region: result.resolved?.region_name || result.resolved?.region_id || "",
      period: result.resolved?.period ? periodText(result.resolved.period) : "",
    };
    const next = [entry, ...readStudies().filter((row) => row.id !== entry.id)].slice(0, 20);
    setHistory(next);
    try {
      localStorage.setItem(historyKey, JSON.stringify(next));
    } catch {
      /* History remains available for this session. */
    }
  }, [result]);

  useEffect(() => {
    if (result) {
      const id = window.location.hash.slice(1);
      const linkedView = linkedStudy === result.identity.id && ["study-crystal-balls", "study-trend-map", "study-evidence"].includes(id)
        ? document.getElementById(id)
        : null;
      (linkedView ?? resultHeadingRef.current)?.focus();
    } else if (error) noticeRef.current?.focus();
  }, [result, error, linkedStudy]);

  function fieldChanged() {
    discard();
    boundPreset.current = null;
    setValidation("");
  }
  function chooseRegion(id: string | null, alternatives: Region[] = []) {
    pickToken.current++;
    fieldChanged();
    setRegionId(id);
    setOverlap(alternatives);
    setPickStatus("");
    setListOpen(false);
  }
  const chooseRef = useRef(chooseRegion);
  useEffect(() => {
    chooseRef.current = chooseRegion;
  });
  const onPick = useCallback(
    async (point: { lon: number; lat: number; zoom: number }) => {
      const token = ++pickToken.current;
      setPickStatus("Looking up boundaries…");
      try {
        const picked = await pickRegions(point.lon, point.lat, point.zoom);
        if (token !== pickToken.current) return;
        const options = [picked.primary, ...picked.alternatives].filter((r): r is Region => !!r);
        const first = options.find((r) => r.type === layer) ?? options[0];
        if (!first) {
          setPickStatus("No matching boundary here. Search for a region by name.");
          return;
        }
        chooseRef.current(
          first.id,
          options.filter((r) => r.id !== first.id),
        );
      } catch {
        if (token === pickToken.current) setPickStatus("The map lookup failed. Try the region list.");
      }
    },
    [layer],
  );

  function run(query: string, region: string | null, window: Period, preset: PresetRef | null = null) {
    const q = query.trim();
    if (!q) {
      setValidation("Describe the Earth-system phenomenon you want to investigate.");
      return;
    }
    const invalidPeriod = validateMonths(window, true);
    if (invalidPeriod) {
      setValidation(invalidPeriod);
      return;
    }
    setValidation("");
    const request: ResearchRequest = {
      phenomenon_query: q,
      region_id: region,
      period: window.start ? window : null,
      context: {
        parent_research_id: parentId.current,
        preset_ref: preset ? { id: preset.id, version: preset.version } : null,
      },
    };
    currentRequest.current = request;
    void start({ request });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    run(phenomenon, regionId, months, boundPreset.current);
  }
  function applyPeriod(window: Period) {
    boundPreset.current = null;
    setMonths(window);
    run(phenomenon, regionId, window);
    noticeRef.current?.scrollIntoView({ block: "nearest" });
  }
  function openPreset(preset: Preset) {
    const query = preset.phenomenon_query || phenomenon;
    setPhenomenon(query);
    boundPreset.current = preset;
    run(query, regionId, months, preset);
  }
  function openHistory(id: string) {
    if (linkedStudy === id) {
      currentRequest.current = null;
      appliedId.current = null;
      void start({ id });
    } else router.push("/explore?research=" + encodeURIComponent(id), { scroll: false });
  }
  const presets = [...(catalogue?.presets ?? [])];
  if (currentPreset && !presets.some((p) => p.id === currentPreset.id && p.version === currentPreset.version))
    presets.unshift(currentPreset);

  return (
    <div className="research">
      <section className="on-stage stage-sky">
        <div className="research-width study-stage">
          <div className="research-entry">
            <h1 className="text-4xl sm:text-[2.8rem]">Earth System Trend Detective</h1>
            <p className="mt-2 max-w-xl text-on-stage-2">
              Play a region’s history in the crystal balls and compare its trends on the globe.
            </p>
            <form onSubmit={submit} noValidate className="research-form research-paper mt-5">
              <label htmlFor="phenomenon">What would you like to investigate?</label>
              <textarea
                id="phenomenon"
                rows={2}
                value={phenomenon}
                placeholder="How has rainfall changed?"
                onChange={(e) => {
                  fieldChanged();
                  setPhenomenon(e.target.value);
                }}
                aria-describedby="phenomenon-note"
              />
              <p id="phenomenon-note" className="form-hint">
                Ask in English. Chinese is also supported.
                {catalogue?.selector?.mode === "ollama" && catalogue.selector.custom_queries_available &&
                  " A local model selects relevant variables."} Choose the location and dates below.
              </p>
              {catalogue?.curated_phenomena?.length ? (
                <details className="mt-2 text-sm">
                  <summary className="text-link">Browse prepared phenomena</summary>
                  {catalogue.selector?.custom_queries_available === false && (
                    <p className="form-hint">
                      These prepared topics are available. The model for other descriptions is currently unavailable.
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {catalogue.curated_phenomena.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="text-button"
                        onClick={() => {
                          fieldChanged();
                          setPhenomenon(q);
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
              <div className="mt-4">
                <p className="field-title">
                  Region <span>Optional</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="research-button" onClick={() => setListOpen(true)}>
                    {selected?.name || regionAvailability?.name || regionId || "Choose a region"}
                  </button>
                  {regionId && (
                    <button type="button" className="text-button" onClick={() => chooseRegion(null)}>
                      Clear region
                    </button>
                  )}
                </div>
                {regionAvailability?.series_available === false && (
                  <p className="form-hint">No prepared variable series is indexed for this boundary.</p>
                )}
                {overlap.length > 0 && (
                  <details className="mt-2 text-sm">
                    <summary>Other boundaries at this location</summary>
                    <ul>
                      {overlap.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              chooseRegion(r.id, [
                                ...(selected ? [selected] : []),
                                ...overlap.filter((o) => o.id !== r.id),
                              ])
                            }
                          >
                            {r.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <fieldset className="mt-4">
                <legend className="field-title">
                  Analysis period <span>Optional</span>
                </legend>
                <div className="month-pair">
                  <MonthField
                    label="Start"
                    value={months.start}
                    onChange={(value) => {
                      fieldChanged();
                      setMonths((current) => ({ ...current, start: value }));
                    }}
                  />
                  <MonthField
                    label="End"
                    value={months.end}
                    onChange={(value) => {
                      fieldChanged();
                      setMonths((current) => ({ ...current, end: value }));
                    }}
                  />
                </div>
                {(months.start || months.end) && (
                  <button
                    type="button"
                    className="text-button mt-1"
                    onClick={() => {
                      fieldChanged();
                      setMonths(emptyMonths);
                    }}
                  >
                    Clear period
                  </button>
                )}
              </fieldset>
              <p className="form-hint mt-3">A preset supplies any region or period you leave open.</p>
              {validation && (
                <p role="alert" className="research-note">
                  {validation}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button id="start-research" className="research-primary" type="submit" disabled={busy}>
                  {busy ? "Running research…" : "Start research"}
                </button>
                {busy && (
                  <button type="button" className="research-button" onClick={() => void cancel()}>
                    Cancel study
                  </button>
                )}
              </div>
              <div ref={noticeRef} tabIndex={-1} id="study-progress">
                {busy && (
                  <p role="status" className="form-hint mt-2">
                    {words(job?.stage || "starting_study")}
                    {job?.total != null && job.total > 1 && ` · ${job.completed ?? 0} of ${job.total}`}
                  </p>
                )}
                {error && (
                  <div className="research-notice">
                    <div role="alert">
                      <strong>{error.code === "selector_unavailable" ? "Couldn’t select variables for this topic" : words(error.code)}</strong>
                      <p>{error.message}</p>
                    </div>
                    {error.code === "selector_unavailable" && !!catalogue?.curated_phenomena?.length && (
                      <label className="mt-3 block">
                        Choose a prepared topic
                        <select
                          className="research-button mt-1 block"
                          value=""
                          onChange={(e) => {
                            fieldChanged();
                            setPhenomenon(e.target.value);
                            document.getElementById("start-research")?.focus();
                          }}
                        >
                          <option value="" disabled>Select a topic</option>
                          <optgroup label="Phenomena">
                            {catalogue.curated_phenomena.map((topic) => <option key={topic}>{topic}</option>)}
                          </optgroup>
                          <optgroup label="Measurements">
                            {catalogue.variables.map((v) => <option key={v.variable_id}>{v.label}</option>)}
                          </optgroup>
                        </select>
                      </label>
                    )}
                    {error.evidence_family && (
                      <RecordDetails title="Searched candidates and exclusions" value={error.evidence_family} />
                    )}
                    {error.retryable && <button type="button" className="text-button mt-2" onClick={retry}>Retry study</button>}
                  </div>
                )}
                {job?.status === "cancelled" && <p className="form-hint mt-2" role="status">Study cancelled. Your input is ready for another run.</p>}
                {result && <p className="form-hint mt-2" role="status">Study ready. <a className="text-button" href="#results-heading">View results</a></p>}
              </div>
            </form>
            {(apiFailure || geoFailure) && (
              <div role="alert" className="research-paper research-notice">
                <strong>{apiFailure ? "Research catalogue unavailable" : "Region map unavailable"}</strong>
                <p>{apiFailure || geoFailure}</p>
                <button type="button" className="text-button" onClick={() => setLoadAttempt((a) => a + 1)}>
                  Retry loading catalogue
                </button>
              </div>
            )}
          </div>
          <div className="research-globe">
            {!wide && (
              <button
                type="button"
                className="mb-3 rounded-ctl border border-stage-line px-4 py-2"
                aria-expanded={showGlobe}
                onClick={() => setShowGlobe((v) => !v)}
              >
                {showGlobe ? "Hide globe" : "Choose on globe"}
              </button>
            )}
            {(wide || showGlobe) && (
              <>
                <GlobePane
                  layer={layer}
                  onLayerChange={(l) => {
                    automaticLayer.current = false;
                    setLayer(l);
                  }}
                  selected={selected}
                  overlay={null}
                  overlayChoices={[]}
                  onOverlayChange={() => {}}
                  onPick={onPick}
                  onZoomChange={(z) => {
                    if (automaticLayer.current) setLayer(z >= 2 ? "basin4" : "basin3");
                  }}
                  pickStatus={pickStatus}
                  canvasClassName="research-planet"
                />
                <p className="mt-2 text-center text-xs text-on-stage-2">
                  Illustrative landscape · Selectable research boundaries
                </p>
              </>
            )}
          </div>
        </div>
      </section>
      {result && (
        <StudyResults
          key={result.identity.id}
          result={result}
          headingRef={resultHeadingRef}
          onApply={applyPeriod}
          onPreset={openPreset}
          keepRegion={chooseRegion}
          keepPeriod={(p) => {
            fieldChanged();
            setMonths(p);
          }}
        />
      )}
      {(history.length > 0 || presets.length > 0) && (
        <aside className="research-width past-studies">
          {history.length > 0 && (
            <details>
              <summary>Study history ({history.length})</summary>
              <ul>
                {history.map((row) => (
                  <li key={row.id}>
                    <button type="button" onClick={() => openHistory(row.id)}>
                      {row.title} <span>{[row.region, row.period].filter(Boolean).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {presets.length > 0 && (
            <details>
              <summary>Published presets ({presets.length})</summary>
              <ul>
                {presets.map((p) => (
                  <li key={p.id + p.version}>
                    <button type="button" onClick={() => openPreset(p)}>
                      {p.phenomenon_query}{" "}
                      <span>
                        {p.region_name || p.region_id} · {periodText(p.period)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      )}
      <RegionDialog open={listOpen} onClose={() => setListOpen(false)} title="Choose one region">
        <div className="research-search research-paper">
          {geo ? (
            <RegionSearch catalog={geo} onSelect={(r) => chooseRegion(r.id)} autoFocus />
          ) : (
            <p role="status">{geoFailure || "Loading the region list…"}</p>
          )}
          <h3 className="mt-6 text-xl">Featured regions</h3>
          <ul className="mt-2 divide-y divide-line">
            {FEATURED_SHORT.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="block w-full py-2 text-left"
                  onClick={() => chooseRegion(f.id)}
                >
                  {f.name}
                  <span className="block text-sm text-ink-2">{f.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </RegionDialog>
    </div>
  );
}
