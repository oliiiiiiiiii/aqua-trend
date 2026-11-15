"use client";
// State of the research page (spec §3.2, §9, §10; data contracts §9.1).
//
// Three kinds of state are kept apart on purpose:
//   - the FORM: what the user typed or picked (phenomenon text, one region id, an optional period). Only these
//     values are ever sent as `region_id` / `period`. A preset value shown in a result never enters the form
//     unless the user explicitly keeps it.
//   - the JOB: the backend's research job for the last request. Only responses that belong to the current run
//     may change the page; anything older is dropped.
//   - the VIEW (in ResearchApp): what part of the time axis is on screen. It never changes a number.
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlobePoint } from "@/lib/contracts";
import { loadCatalog, pickRegions } from "@/lib/data";
import type { Catalog, Region } from "@/lib/types";
import type { PickableLayer } from "@/components/explore/GlobePane";
import {
  cancelResearch,
  createResearch,
  getCatalogue,
  getCatalogueRegion,
  getResearch,
  isAbort,
  pollResearch,
  ResearchApiError,
} from "@/lib/research/api";
import { isYm, ymIndex } from "@/lib/research/format";
import type {
  CataloguePhenomenon,
  CatalogueRegion,
  Period,
  PresetRef,
  ResearchJob,
  ResearchRequest,
} from "@/lib/research/types";
import { isTerminal } from "@/lib/research/types";

export interface FormState {
  q: string;
  regionId: string | null;
  from: string;
  to: string;
}

export interface FieldErrors {
  q?: string;
  period?: string;
  region?: string;
}

export type RunPhase = "idle" | "submitting" | "running" | "done" | "error";

export type RegionAvailability =
  | { state: "none" }
  | { state: "checking" }
  | { state: "known"; region: CatalogueRegion }
  | { state: "unknown"; message: string };

export type BackendState = { state: "checking" } | { state: "ok" } | { state: "down"; message: string };

export interface StartOptions {
  /** overrides for this request only (they are also written to the form: they are user choices) */
  period?: Period | null;
  regionId?: string | null;
  /** link to the result being adjusted */
  parentResearchId?: string | null;
  /** phenomenon text for this request (also written to the form) */
  query?: string;
  /** send no context at all (after an invalid_context answer) */
  dropContext?: boolean;
}

export interface ResearchState {
  form: FormState;
  setQuery: (q: string) => void;
  setPeriodField: (which: "from" | "to", value: string) => void;
  clearPeriod: () => void;
  selectRegion: (r: Region) => void;
  clearRegion: () => void;
  fieldErrors: FieldErrors;

  /** the front-end region catalogue (ids, names, geometry for the globe) */
  catalog: Catalog | null;
  catalogStatus: "loading" | "ready" | "error";
  /** the form's region, when its id is in the catalogue */
  region: Region | null;
  unknownRegionId: string | null;
  availability: RegionAvailability;

  backend: BackendState;
  recheckBackend: () => void;
  phenomena: CataloguePhenomenon[];

  phase: RunPhase;
  job: ResearchJob | null;
  /** the request of the current run (what was actually sent) */
  sentRequest: ResearchRequest | null;
  error: ResearchApiError | null;
  /** true while a request is being created or polled */
  busy: boolean;
  cancelling: boolean;

  start: (opts?: StartOptions) => void;
  cancel: () => void;
  /** after a failure: resume polling the same job when there is one, otherwise send the same request again */
  retry: () => void;
  /** send the last request again without parent / preset links */
  retryWithoutContext: () => void;
  /** take a resolved (preset) value into the form as the user's own choice */
  keepRegion: (regionId: string) => void;
  keepPeriod: (period: Period) => void;
  presetRef: PresetRef | null;

  /* globe */
  layer: PickableLayer;
  setLayer: (l: PickableLayer) => void;
  onZoomChange: (z: number) => void;
  onPick: (p: GlobePoint & { zoom: number }) => void;
  pickStatus: string;
}

const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;

function parsePreset(raw: string | null): PresetRef | null {
  if (!raw) return null;
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return null;
  return { id: raw.slice(0, at), version: raw.slice(at + 1) };
}

/** Both ends or neither (data contract §8). Returns the period, null for "no period", or an error text. */
export function readPeriod(from: string, to: string): { period: Period | null; error?: string } {
  const a = from.trim(), b = to.trim();
  if (!a && !b) return { period: null };
  if (!a || !b) {
    return {
      period: null,
      error: `Only the ${a ? "start" : "end"} month is filled in. Give both months, or clear the period to let a preset suggest one.`,
    };
  }
  if (!isYm(a) || !isYm(b)) {
    return { period: null, error: "Write each month as YYYY-MM, for example 2005-01." };
  }
  if (ymIndex(a) > ymIndex(b)) {
    return { period: null, error: "The start month is after the end month." };
  }
  return { period: { start: a, end: b } };
}

function toApiError(e: unknown): ResearchApiError {
  if (e instanceof ResearchApiError) return e;
  return new ResearchApiError(
    { code: "client_error", message: e instanceof Error ? e.message : String(e), retryable: true, fields: [] },
    0,
  );
}

export function useResearch(): ResearchState {
  const sp = useSearchParams();
  // the URL is read once; afterwards this hook owns it
  const initial = useRef({
    q: sp.get("q") ?? "",
    region: sp.get("region"),
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    id: sp.get("id"),
    preset: parsePreset(sp.get("preset")),
  }).current;

  const [form, setForm] = useState<FormState>({ q: initial.q, regionId: initial.region, from: initial.from, to: initial.to });
  const formRef = useRef(form);
  formRef.current = form;
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [presetRef, setPresetRef] = useState<PresetRef | null>(initial.preset);
  /** the phenomenon text the preset link was opened with; a different text unbinds the preset */
  const presetQuery = useRef(initial.q.trim());

  /* ------------------------------------------------------------ front-end region catalogue */
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let live = true;
    loadCatalog().then(
      (c) => { if (live) { setCatalog(c); setCatalogStatus("ready"); } },
      () => { if (live) setCatalogStatus("error"); },
    );
    return () => { live = false; };
  }, []);
  const region = (catalog && form.regionId && catalog.byId.get(form.regionId)) || null;
  const unknownRegionId = catalog && form.regionId && !region ? form.regionId : null;

  /* ------------------------------------------------------------ backend catalogue (hint chips, reachability) */
  const [backend, setBackend] = useState<BackendState>({ state: "checking" });
  const [phenomena, setPhenomena] = useState<CataloguePhenomenon[]>([]);
  const [backendTry, setBackendTry] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setBackend({ state: "checking" });
    getCatalogue(ac.signal).then(
      (c) => {
        setBackend({ state: "ok" });
        setPhenomena(Array.isArray(c.phenomena) ? c.phenomena.filter((p) => p && typeof p.label === "string") : []);
      },
      (e: unknown) => { if (!isAbort(e)) setBackend({ state: "down", message: toApiError(e).message }); },
    );
    return () => ac.abort();
  }, [backendTry]);
  const recheckBackend = useCallback(() => setBackendTry((x) => x + 1), []);

  /* ------------------------------------------------------------ does the chosen region have a prepared series? */
  const [availability, setAvailability] = useState<RegionAvailability>({ state: "none" });
  useEffect(() => {
    const id = form.regionId;
    if (!id) { setAvailability({ state: "none" }); return; }
    const ac = new AbortController();
    setAvailability({ state: "checking" });
    getCatalogueRegion(id, ac.signal).then(
      (r) => setAvailability({ state: "known", region: r }),
      (e: unknown) => { if (!isAbort(e)) setAvailability({ state: "unknown", message: toApiError(e).message }); },
    );
    return () => ac.abort();
  }, [form.regionId, backendTry]);

  /* ------------------------------------------------------------ run state */
  const [phase, setPhase] = useState<RunPhase>(initial.id ? "running" : "idle");
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [error, setError] = useState<ResearchApiError | null>(null);
  const [sentRequest, setSentRequest] = useState<ResearchRequest | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** identity of the current run: every async step checks it before touching state */
  const runSeq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const currentId = useRef<string | null>(null);
  const jobRef = useRef<ResearchJob | null>(null);
  jobRef.current = job;
  const sentRef = useRef<ResearchRequest | null>(null);
  sentRef.current = sentRequest;

  /** Leave the previous run: stop its polling and tell the backend it is no longer wanted. */
  const supersede = useCallback(() => {
    controller.current?.abort();
    const prev = jobRef.current;
    if (prev && !isTerminal(prev.status)) cancelResearch(prev.research_id).catch(() => { /* best effort */ });
    const ac = new AbortController();
    controller.current = ac;
    return { seq: ++runSeq.current, signal: ac.signal };
  }, []);

  const follow = useCallback(async (id: string, seq: number, signal: AbortSignal) => {
    currentId.current = id;
    try {
      await pollResearch(id, {
        signal,
        onUpdate: (j) => {
          // only the current run may update the page (spec §10)
          if (seq !== runSeq.current || j.research_id !== currentId.current) return;
          setJob(j);
          if (isTerminal(j.status)) { setPhase("done"); setCancelling(false); }
          else setPhase("running");
        },
      });
    } catch (e) {
      if (isAbort(e) || seq !== runSeq.current) return;
      const err = toApiError(e);
      // the job is gone (for example the backend restarted): a retry must create a new one
      if (err.status === 404 || err.code === "not_found") currentId.current = null;
      setError(err);
      setPhase("error");
      setCancelling(false);
    }
  }, []);

  const send = useCallback(async (req: ResearchRequest) => {
    const { seq, signal } = supersede();
    currentId.current = null;
    setSentRequest(req);
    setJob(null);
    setError(null);
    setCancelling(false);
    setPhase("submitting");
    try {
      const accepted = await createResearch(req, signal);
      if (seq !== runSeq.current) {
        // a newer request replaced this one while it was being created
        cancelResearch(accepted.research_id).catch(() => { /* best effort */ });
        return;
      }
      setJob({ ...accepted, request: req });
      setPhase("running");
      await follow(accepted.research_id, seq, signal);
    } catch (e) {
      if (isAbort(e) || seq !== runSeq.current) return;
      const err = toApiError(e);
      setError(err);
      setPhase("error");
      const fe: FieldErrors = {};
      for (const f of err.fields) {
        if (f.includes("period")) fe.period = err.message;
        else if (f.includes("region")) fe.region = err.message;
        else if (f.includes("phenomenon") || f.includes("query")) fe.q = err.message;
      }
      if (Object.keys(fe).length) setFieldErrors(fe);
    }
  }, [follow, supersede]);

  const start = useCallback((opts: StartOptions = {}) => {
    const f = formRef.current;
    const next: FormState = { ...f };
    if (opts.period !== undefined) { next.from = opts.period?.start ?? ""; next.to = opts.period?.end ?? ""; }
    if (opts.regionId !== undefined) next.regionId = opts.regionId;
    if (opts.query !== undefined) next.q = opts.query;
    setForm(next);
    formRef.current = next;

    const errs: FieldErrors = {};
    const q = next.q.trim();
    if (!q) errs.q = "Describe the phenomenon you want to look at, for example “drought” or “乾旱”.";
    const { period, error: periodError } = readPeriod(next.from, next.to);
    if (periodError) errs.period = periodError;
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    // context (data contract §9.1): keep the parent link when a shown result is being adjusted; a preset stays
    // bound only while the phenomenon is the one it was opened with and no period was brushed on top of it
    const shown = jobRef.current?.result ? jobRef.current.research_id : null;
    const parent = opts.dropContext ? null : opts.parentResearchId !== undefined ? opts.parentResearchId : shown;
    let preset = opts.dropContext ? null : presetRef;
    if (preset && (q !== presetQuery.current || opts.period !== undefined)) preset = null;
    if (preset !== presetRef) setPresetRef(preset);

    void send({
      phenomenon_query: q,
      region_id: next.regionId,
      period,
      context: { parent_research_id: parent, preset_ref: preset },
    });
  }, [presetRef, send]);

  const retry = useCallback(() => {
    const id = currentId.current;
    const ended = !!jobRef.current && isTerminal(jobRef.current.status);
    if (id && !ended) {
      // the job exists on the backend and has not ended: pick it up again instead of creating a second one
      const { seq, signal } = supersedeKeepingJob(controller, runSeq);
      setError(null);
      setPhase("running");
      void follow(id, seq, signal);
      return;
    }
    if (sentRef.current) void send(sentRef.current);
    else start();
  }, [follow, send, start]);

  const retryWithoutContext = useCallback(() => {
    setPresetRef(null);
    const last = sentRef.current;
    if (last) void send({ ...last, context: { parent_research_id: null, preset_ref: null } });
    else start({ dropContext: true });
  }, [send, start]);

  const cancel = useCallback(() => {
    const id = currentId.current;
    const seq = runSeq.current;
    if (!id) {
      // the request has not been accepted yet: drop it; a late acceptance is cancelled in `send`
      controller.current?.abort();
      runSeq.current++;
      setPhase("idle");
      return;
    }
    setCancelling(true);
    cancelResearch(id).then(
      (j) => {
        // polling normally reports the cancelled state; use the answer directly when it already is terminal
        const status = (j as Partial<ResearchJob>)?.status;
        if (seq !== runSeq.current || !status || !isTerminal(status)) return;
        controller.current?.abort();
        setJob((prev) => (prev ? { ...prev, ...(j as Partial<ResearchJob>) } : prev));
        setPhase("done");
        setCancelling(false);
      },
      (e: unknown) => {
        if (seq !== runSeq.current) return;
        setCancelling(false);
        setError(toApiError(e));
        setPhase("error");
      },
    );
  }, []);

  /* ------------------------------------------------------------ open ?id= once */
  useEffect(() => {
    if (!initial.id) return;
    const { seq, signal } = supersede();
    const id = initial.id;
    currentId.current = id;
    getResearch(id, signal).then(
      (j) => {
        if (seq !== runSeq.current) return;
        setJob(j);
        if (j.request) {
          setSentRequest(j.request);
          // the form shows what this research was actually asked with (user fields only)
          setForm({
            q: j.request.phenomenon_query ?? "",
            regionId: j.request.region_id ?? null,
            from: j.request.period?.start ?? "",
            to: j.request.period?.end ?? "",
          });
          presetQuery.current = (j.request.phenomenon_query ?? "").trim();
        }
        if (isTerminal(j.status)) setPhase("done");
        else { setPhase("running"); void follow(id, seq, signal); }
      },
      (e: unknown) => {
        if (isAbort(e) || seq !== runSeq.current) return;
        const err = toApiError(e);
        if (err.status === 404 || err.code === "not_found") currentId.current = null;
        setError(err);
        setPhase("error");
      },
    );
  }, [follow, initial.id, supersede]);

  useEffect(() => () => controller.current?.abort(), []);

  /* ------------------------------------------------------------ URL (q, region, from, to, id, preset) */
  const jobId = job?.research_id ?? (phase === "error" ? currentId.current : null);
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (form.q.trim()) p.set("q", form.q.trim());
      if (form.regionId) p.set("region", form.regionId);
      if (form.from.trim()) p.set("from", form.from.trim());
      if (form.to.trim()) p.set("to", form.to.trim());
      if (jobId) p.set("id", jobId);
      if (presetRef) p.set("preset", `${presetRef.id}@${presetRef.version}`);
      const qs = p.toString();
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
    }, 250);
    return () => clearTimeout(t);
  }, [form, jobId, presetRef]);

  /* ------------------------------------------------------------ form setters */
  const setQuery = useCallback((q: string) => {
    setForm((f) => ({ ...f, q }));
    setFieldErrors((e) => (e.q ? { ...e, q: undefined } : e));
  }, []);
  const setPeriodField = useCallback((which: "from" | "to", value: string) => {
    setForm((f) => ({ ...f, [which]: value }));
    setFieldErrors((e) => (e.period ? { ...e, period: undefined } : e));
  }, []);
  const clearPeriod = useCallback(() => {
    setForm((f) => ({ ...f, from: "", to: "" }));
    setFieldErrors((e) => ({ ...e, period: undefined }));
  }, []);
  const selectRegion = useCallback((r: Region) => {
    setForm((f) => ({ ...f, regionId: r.id }));
    setFieldErrors((e) => ({ ...e, region: undefined }));
    setPickStatus("");
  }, []);
  const clearRegion = useCallback(() => {
    setForm((f) => ({ ...f, regionId: null }));
    setFieldErrors((e) => ({ ...e, region: undefined }));
  }, []);
  const keepRegion = useCallback((regionId: string) => setForm((f) => ({ ...f, regionId })), []);
  const keepPeriod = useCallback((p: Period) => setForm((f) => ({ ...f, from: p.start, to: p.end })), []);

  /* ------------------------------------------------------------ globe */
  const [layer, setLayerState] = useState<PickableLayer>("basin3");
  const layerByHand = useRef(false);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const setLayer = useCallback((l: PickableLayer) => { layerByHand.current = true; setLayerState(l); }, []);
  const onZoomChange = useCallback((z: number) => {
    if (layerByHand.current) return;
    setLayerState((prev) => (prev === "basin3" || prev === "basin4" ? (z >= 2 ? "basin4" : "basin3") : prev));
  }, []);
  const [pickStatus, setPickStatus] = useState("");
  const pickSeq = useRef(0);
  const selectRef = useRef(selectRegion);
  selectRef.current = selectRegion;
  const onPick = useCallback(async ({ lon, lat, zoom }: GlobePoint & { zoom: number }) => {
    const seq = ++pickSeq.current;
    setPickStatus(`Looking up regions at ${fmtLat(lat)}, ${fmtLon(lon)}…`);
    try {
      const res = await pickRegions(lon, lat, zoom);
      if (seq !== pickSeq.current) return;
      const all = [res.primary, ...res.alternatives].filter((r): r is Region => !!r);
      if (!all.length) {
        setPickStatus(`No region here (${fmtLat(lat)}, ${fmtLon(lon)}). Try land or a marine region, or search by name.`);
        return;
      }
      // what is outlined is what gets selected: prefer the layer the globe is drawing
      selectRef.current(all.find((r) => r.type === layerRef.current) ?? all[0]);
    } catch (e) {
      if (seq !== pickSeq.current) return;
      setPickStatus(`Could not look up regions: ${e instanceof Error ? e.message : String(e)}. Click again or search by name.`);
    }
  }, []);

  const busy = phase === "submitting" || phase === "running";

  return useMemo<ResearchState>(() => ({
    form, setQuery, setPeriodField, clearPeriod, selectRegion, clearRegion, fieldErrors,
    catalog, catalogStatus, region, unknownRegionId, availability,
    backend, recheckBackend, phenomena,
    phase, job, sentRequest, error, busy, cancelling,
    start, cancel, retry, retryWithoutContext, keepRegion, keepPeriod, presetRef,
    layer, setLayer, onZoomChange, onPick, pickStatus,
  }), [
    form, setQuery, setPeriodField, clearPeriod, selectRegion, clearRegion, fieldErrors,
    catalog, catalogStatus, region, unknownRegionId, availability,
    backend, recheckBackend, phenomena,
    phase, job, sentRequest, error, busy, cancelling,
    start, cancel, retry, retryWithoutContext, keepRegion, keepPeriod, presetRef,
    layer, setLayer, onZoomChange, onPick, pickStatus,
  ]);
}

/** New polling controller for the SAME job (retry after a network failure): the job is not cancelled. */
function supersedeKeepingJob(
  controller: React.RefObject<AbortController | null>,
  runSeq: React.RefObject<number>,
): { seq: number; signal: AbortSignal } {
  controller.current?.abort();
  const ac = new AbortController();
  controller.current = ac;
  runSeq.current += 1;
  return { seq: runSeq.current, signal: ac.signal };
}
