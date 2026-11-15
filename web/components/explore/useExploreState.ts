"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlobePoint, OrbClimate } from "@/lib/contracts";
import type { Catalog, Lead, Region, RegionSeries, VarId } from "@/lib/types";
import { loadCatalog, loadRegionSeries, pickRegions } from "@/lib/data";
import type { PickableLayer } from "./GlobePane";
import { useReducedMotion } from "./hooks";
import { SEASON_DEFAULT, cleanTargets, climateOf, nextIn, parseSeason, suggestTargets, valuesAt, windowIndices, type PlayWindow, type Suggestion } from "./regionUtils";

export type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

interface UrlState { region: string | null; targets: VarId[] | null; month: string | null }

/** Everything an Explore layout needs. Returned by `useExploreState()`; layouts only render and call these. */
export interface ExploreState {
  /* ------------------------------------------------------------ catalogue */
  /** the 7,641-region catalogue, null while loading or after a failed load */
  catalog: Catalog | null;
  catalogStatus: "loading" | "ready" | "error";
  catalogError: string | null;
  retryCatalog: () => void;

  /* ------------------------------------------------------------ region (state lives in ?region=) */
  /** the selected region, or null (none chosen, or the id in the URL is unknown) */
  region: Region | null;
  /** the raw `?region=` value, even before the catalogue has loaded (to tell "loading a linked region" from "no region") */
  requestedRegionId: string | null;
  /** the `?region=` value when it is not in the catalogue, so the picker can explain what happened */
  unknownRegionId: string | null;
  /** select a region (writes the URL, stops playback, clears the selected lead). `fromPick`: ids of all overlapping regions at the clicked point */
  selectRegion: (r: Region, opts?: { fromPick?: string[] }) => void;
  /** go back to "no region selected" (keeps the targets so the next region is compared on the same terms) */
  clearRegion: () => void;
  /** other boundaries containing the last globe click, excluding `region` */
  alternatives: Region[];

  /* ------------------------------------------------------------ series */
  /** "idle" = no region. "ready" with `series === null` = the region has no land-model data (ocean, ice) */
  seriesStatus: "idle" | "loading" | "ready" | "error";
  seriesError: string | null;
  retrySeries: () => void;
  /** undefined = not known yet (idle/loading/error), null = no land-model data here, else the monthly series */
  series: RegionSeries | null | undefined;
  /** long-term regional means for the ball's scenery; null without a series */
  climate: OrbClimate | null;

  /* ------------------------------------------------------------ targets (state lives in ?targets=) */
  /** 1-3 water targets in catalogue order: the URL's, else the suggested set */
  targets: VarId[];
  setTargets: (t: VarId[]) => void;
  /** the climate-based starting set and why */
  suggestion: Suggestion;

  /* ------------------------------------------------------------ month + playback (state lives in ?month=) */
  /** "YYYY-MM" for every month in the catalogue, empty until it loads */
  months: string[];
  monthIndex: number;
  /** `months[monthIndex]`, "" until the catalogue loads */
  month: string;
  /** clamps to the available range */
  setMonthIndex: (i: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  /** months per second */
  speed: number;
  setSpeed: (s: number) => void;
  reducedMotion: boolean;
  /** this month's regional values (empty object without a series); NaN = missing month */
  values: Partial<Record<VarId, number | null>>;
  /** playback window (state lives in ?from=&to=&season=, defaults left out): the whole series, all twelve months */
  window: PlayWindow;
  /** first and last year of the series (bounds for the window's years) */
  yearRange: [number, number];
  /** change any part of the window; keeps from <= to */
  setWindow: (patch: Partial<PlayWindow>) => void;
  /** ascending month indices that playback and stepping visit (the window, never empty once the series is known) */
  sequence: number[];

  /* ------------------------------------------------------------ ball */
  /** "colour the vapour by air temperature" preference (only effective while ET is a target) */
  tairColour: boolean;
  setTairColour: (on: boolean) => void;
  /** what actually colours the vapour: the selected lead's channel, else air temperature, else null */
  colorBy: VarId | null;
  /** diorama style of the crystal ball (state lives in ?orb=glass|hex|island; "glass" is the default and is left out of the URL) */
  orbVariant: OrbStyle;
  setOrbVariant: (v: OrbStyle) => void;
  /** leader lines from the read-out to the parts of the ball (state lives in ?leaders=0 when off; on is the default and left out) */
  leaders: boolean;
  setLeaders: (on: boolean) => void;
  selectedLead: Lead | null;
  setSelectedLead: (l: Lead | null) => void;

  /* ------------------------------------------------------------ globe + picker */
  /** boundary layer drawn on the globe */
  layer: PickableLayer;
  setLayer: (l: PickableLayer) => void;
  onZoomChange: (z: number) => void;
  /** trend-map overlay variable (always one of `targets`), null = illustrative landscape */
  overlay: VarId | null;
  setOverlay: (v: VarId | null) => void;
  /** variables that can be shown as a trend map: the targets, empty without a series */
  overlayChoices: VarId[];
  /** globe click handler: resolves the point to regions and selects the best one */
  onPick: (p: GlobePoint & { zoom: number }) => void;
  /** status line for the last globe click ("Looking up…", "No region here…"), "" when idle */
  pickStatus: string;
  /** the region picker overlay (globe + search). Layouts with a permanent picker can ignore these. */
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
}

const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type OrbStyle = "glass" | "hex" | "island";
const cleanOrb = (v: string | null): OrbStyle => (v === "hex" || v === "island" ? v : "glass");

export function useExploreState(): ExploreState {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();

  /* ------------------------------------------------------------ catalogue */
  const [catalogLoad, setCatalogLoad] = useState<Load<Catalog>>({ status: "loading" });
  const [catalogTry, setCatalogTry] = useState(0);
  useEffect(() => {
    let live = true;
    loadCatalog().then(
      (c) => live && setCatalogLoad({ status: "ready", data: c }),
      (e: unknown) => live && setCatalogLoad({ status: "error", message: msg(e) }),
    );
    return () => { live = false; };
  }, [catalogTry]);
  const catalog = catalogLoad.status === "ready" ? catalogLoad.data : null;
  const retryCatalog = useCallback(() => { setCatalogLoad({ status: "loading" }); setCatalogTry((x) => x + 1); }, []);

  /* ------------------------------------------------------------ URL state (validated) */
  const rawRegion = sp.get("region");
  const rawTargets = sp.get("targets");
  const rawMonth = sp.get("month");
  const orbVariant = cleanOrb(sp.get("orb"));
  const orbRef = useRef(orbVariant);
  orbRef.current = orbVariant;
  const leaders = sp.get("leaders") !== "0";
  const leadersRef = useRef(leaders);
  leadersRef.current = leaders;
  const rawFrom = sp.get("from");
  const rawTo = sp.get("to");
  const rawSeason = sp.get("season");
  const region = (catalog && rawRegion && catalog.byId.get(rawRegion)) || null;
  const unknownRegionId = catalog && rawRegion && !region ? rawRegion : null;
  const urlTargets = useMemo(() => cleanTargets(rawTargets), [rawTargets]);

  const winUrlRef = useRef<{ from: number | null; to: number | null; season: string | null }>({ from: null, to: null, season: null });
  const writeUrl = useCallback(
    (s: UrlState, how: "router" | "history" = "history") => {
      const p = new URLSearchParams();
      if (s.region) p.set("region", s.region);
      if (s.targets?.length) p.set("targets", s.targets.join(","));
      if (s.region && s.month) p.set("month", s.month);
      if (orbRef.current !== "glass") p.set("orb", orbRef.current);
      if (!leadersRef.current) p.set("leaders", "0");
      if (s.region) {
        const w = winUrlRef.current;
        if (w.from != null) p.set("from", String(w.from));
        if (w.to != null) p.set("to", String(w.to));
        if (w.season) p.set("season", w.season);
      }
      const qs = p.toString().replace(/%2C/g, ",");
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (how === "history") window.history.replaceState(null, "", url);
      else router.replace(url, { scroll: false });
    },
    [pathname, router],
  );

  /* ------------------------------------------------------------ series */
  const [seriesLoad, setSeriesLoad] = useState<{ id: string; load: Load<RegionSeries | null> } | null>(null);
  const [seriesTry, setSeriesTry] = useState(0);
  useEffect(() => {
    if (!region || !catalog) return;
    let live = true;
    setSeriesLoad({ id: region.id, load: { status: "loading" } });
    loadRegionSeries(region, catalog).then(
      (s) => live && setSeriesLoad({ id: region.id, load: { status: "ready", data: s } }),
      (e: unknown) => live && setSeriesLoad({ id: region.id, load: { status: "error", message: msg(e) } }),
    );
    return () => { live = false; };
  }, [region, catalog, seriesTry]);
  const sLoad: Load<RegionSeries | null> | null = !region
    ? null
    : seriesLoad?.id === region.id ? seriesLoad.load : { status: "loading" };
  const series = sLoad?.status === "ready" ? sLoad.data : undefined;
  const retrySeries = useCallback(() => setSeriesTry((x) => x + 1), []);

  const climate = useMemo(() => (series ? climateOf(series) : null), [series]);
  const suggestion = useMemo(() => suggestTargets(climate), [climate]);
  const targets: VarId[] = urlTargets ?? suggestion.targets;

  /* ------------------------------------------------------------ month + playback */
  const months = useMemo(() => catalog?.months ?? [], [catalog]);
  const n = months.length;
  const yearRange = useMemo<[number, number]>(
    () => (n ? [Number(months[0].slice(0, 4)), Number(months[n - 1].slice(0, 4))] : [2000, 2026]),
    [months, n],
  );
  const [y0, y1] = yearRange;
  const window_ = useMemo<PlayWindow>(() => {
    const clampY = (v: string | null, d: number) => {
      const x = v && /^\d{4}$/.test(v) ? Number(v) : d;
      return Math.max(y0, Math.min(y1, x));
    };
    const from = clampY(rawFrom, y0);
    const to = Math.max(from, clampY(rawTo, y1));
    const [startMonth, endMonth] = parseSeason(rawSeason) ?? [1, 12];
    return { from, to, startMonth, endMonth };
  }, [rawFrom, rawTo, rawSeason, y0, y1]);
  // what the URL carries: only the non-default parts (before the catalogue loads, pass the raw values through)
  const winUrl = useMemo(() => {
    if (!n) {
      const season = parseSeason(rawSeason);
      return { from: rawFrom && /^\d{4}$/.test(rawFrom) ? Number(rawFrom) : null, to: rawTo && /^\d{4}$/.test(rawTo) ? Number(rawTo) : null, season: season ? `${season[0]}-${season[1]}` : null };
    }
    const w = window_;
    const season = `${w.startMonth}-${w.endMonth}`;
    return { from: w.from === y0 ? null : w.from, to: w.to === y1 ? null : w.to, season: season === SEASON_DEFAULT ? null : season };
  }, [n, rawFrom, rawTo, rawSeason, window_, y0, y1]);
  winUrlRef.current = winUrl;
  const sequence = useMemo(() => {
    if (!n) return [];
    const seq = windowIndices(months, window_);
    return seq.length ? seq : months.map((_, i) => i);
  }, [months, n, window_]);
  const urlMonthIdx = rawMonth ? months.indexOf(rawMonth) : -1;
  const [monthIdx, setMonthIdx] = useState<number | null>(null);
  const mi = monthIdx ?? (urlMonthIdx >= 0 ? urlMonthIdx : Math.max(0, n - 1));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);

  // follow the URL when it changes from outside (back/forward, a pasted link)
  const lastUrlMonth = useRef<string | null>(null);
  useEffect(() => {
    if (rawMonth === lastUrlMonth.current) return;
    lastUrlMonth.current = rawMonth;
    if (urlMonthIdx >= 0 && !playing) setMonthIdx(urlMonthIdx);
  }, [rawMonth, urlMonthIdx, playing]);

  const miRef = useRef(mi);
  miRef.current = mi;
  useEffect(() => {
    if (!playing || !sequence.length) return;
    const t = window.setInterval(() => {
      // step through the window only; from outside it, resume at the next in-window month; loop at the end
      setMonthIdx((i) => nextIn(sequence, i ?? miRef.current) ?? sequence[0]);
    }, 1000 / speed);
    return () => window.clearInterval(t);
  }, [playing, speed, sequence]);

  const setMonthIndex = useCallback((i: number) => setMonthIdx(Math.max(0, Math.min(n - 1, i))), [n]);

  /* ------------------------------------------------------------ canonical URL */
  // Once the catalogue (and, for a region, its series) is known, drop junk and fill in defaults.
  useEffect(() => {
    // no region (or an unknown one): leave the URL alone so the picker can explain what happened
    if (!catalog || !region || playing) return;
    const want: UrlState = {
      region: region.id,
      targets: series === undefined && !urlTargets ? null : targets,
      month: series ? months[mi] : rawMonth && urlMonthIdx >= 0 ? rawMonth : null,
    };
    const same =
      (want.region ?? null) === (rawRegion ?? null) &&
      (want.targets?.join(",") ?? null) === (rawTargets ?? null) &&
      (want.month ?? null) === (rawMonth ?? null);
    if (same) return;
    const onlyMonth = want.region === rawRegion && (want.targets?.join(",") ?? null) === (rawTargets ?? null);
    const t = window.setTimeout(() => {
      lastUrlMonth.current = want.month;
      writeUrl(want);
    }, onlyMonth ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [catalog, region, series, targets, urlTargets, mi, months, playing, rawRegion, rawTargets, rawMonth, urlMonthIdx, writeUrl]);

  /* ------------------------------------------------------------ globe */
  const [layer, setLayerState] = useState<PickableLayer>("basin3");
  const layerByHand = useRef(false);
  const setLayer = useCallback((l: PickableLayer) => { layerByHand.current = true; setLayerState(l); }, []);
  const onZoomChange = useCallback((z: number) => {
    if (layerByHand.current) return;
    setLayerState(z >= 2 ? "basin4" : "basin3");
  }, []);
  const [overlayWant, setOverlay] = useState<VarId | null>(null);
  const overlay = overlayWant && targets.includes(overlayWant) ? overlayWant : null;
  const overlayChoices = useMemo<VarId[]>(() => (series ? targets : []), [series, targets]);

  const [pick, setPick] = useState<{ ids: string[] } | null>(null);
  const [pickStatus, setPickStatus] = useState("");
  const pickSeq = useRef(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const hadRegion = !!region;
  const selectRegion = useCallback(
    (r: Region, opts: { fromPick?: string[] } = {}) => {
      setPlaying(false);
      setSelectedLead(null);
      setPickerOpen(false);
      setPickStatus("");
      setPick(opts.fromPick ? { ids: opts.fromPick } : null);
      writeUrl({ region: r.id, targets: urlTargets, month: rawMonth && urlMonthIdx >= 0 ? rawMonth : null });
      if (!hadRegion) window.scrollTo({ top: 0 });
    },
    [writeUrl, urlTargets, rawMonth, urlMonthIdx, hadRegion],
  );

  const layerRef = useRef(layer);
  layerRef.current = layer;
  const selectRef = useRef(selectRegion);
  selectRef.current = selectRegion;
  const onPick = useCallback(async ({ lon, lat, zoom }: GlobePoint & { zoom: number }) => {
    const seq = ++pickSeq.current;
    setPickStatus(`Looking up regions at ${fmtLat(lat)}, ${fmtLon(lon)}…`);
    try {
      const res = await pickRegions(lon, lat, zoom);
      if (seq !== pickSeq.current) return;
      const all = [res.primary, ...res.alternatives].filter((r): r is Region => !!r);
      if (!all.length) { setPickStatus(`No region here (${fmtLat(lat)}, ${fmtLon(lon)}). Try land or a marine region, or search by name.`); return; }
      // what you see outlined is what you get: prefer the layer the globe is drawing
      const preferred = all.find((r) => r.type === layerRef.current) ?? all[0];
      const ordered = [preferred, ...all.filter((r) => r !== preferred)];
      setPickStatus("");
      selectRef.current(preferred, { fromPick: ordered.map((r) => r.id) });
    } catch (e) {
      if (seq !== pickSeq.current) return;
      setPickStatus(`Could not look up regions: ${msg(e)}. Click again or search by name.`);
    }
  }, []);

  const alternatives = useMemo(() => {
    if (!pick || !region || !catalog || !pick.ids.includes(region.id)) return [];
    return pick.ids.filter((id) => id !== region.id).map((id) => catalog.byId.get(id)).filter((r): r is Region => !!r);
  }, [pick, region, catalog]);

  const clearRegion = useCallback(() => {
    setPlaying(false);
    setPick(null);
    writeUrl({ region: null, targets: urlTargets ?? targets, month: null });
  }, [writeUrl, urlTargets, targets]);

  /* ------------------------------------------------------------ ball */
  const [tairColour, setTairColour] = useState(true);
  const colorBy: VarId | null = selectedLead?.orbColorBy ?? (targets.includes("et") && tairColour ? "tair" : null);
  const values = useMemo(() => (series ? valuesAt(series, mi) : {}), [series, mi]);

  const setTargets = useCallback(
    (t: VarId[]) => writeUrl({ region: rawRegion, targets: t, month: rawMonth }),
    [writeUrl, rawRegion, rawMonth],
  );

  const setWindow = useCallback(
    (patch: Partial<PlayWindow>) => {
      const next = { ...window_, ...patch };
      if (patch.from != null && next.from > next.to) next.to = next.from;
      if (patch.to != null && next.to < next.from) next.from = next.to;
      const season = `${next.startMonth}-${next.endMonth}`;
      winUrlRef.current = {
        from: next.from === y0 ? null : next.from,
        to: next.to === y1 ? null : next.to,
        season: season === SEASON_DEFAULT ? null : season,
      };
      writeUrl({ region: rawRegion, targets: urlTargets, month: series ? months[mi] : rawMonth });
    },
    [window_, y0, y1, writeUrl, rawRegion, urlTargets, series, months, mi, rawMonth],
  );

  const setOrbVariant = useCallback(
    (v: OrbStyle) => {
      orbRef.current = v;
      writeUrl({ region: rawRegion, targets: urlTargets, month: rawMonth });
    },
    [writeUrl, rawRegion, urlTargets, rawMonth],
  );

  const setLeaders = useCallback(
    (on: boolean) => {
      leadersRef.current = on;
      writeUrl({ region: rawRegion, targets: urlTargets, month: rawMonth });
    },
    [writeUrl, rawRegion, urlTargets, rawMonth],
  );

  return {
    catalog,
    catalogStatus: catalogLoad.status,
    catalogError: catalogLoad.status === "error" ? catalogLoad.message : null,
    retryCatalog,
    region,
    requestedRegionId: rawRegion,
    unknownRegionId,
    selectRegion,
    clearRegion,
    alternatives,
    seriesStatus: sLoad ? sLoad.status : "idle",
    seriesError: sLoad?.status === "error" ? sLoad.message : null,
    retrySeries,
    series,
    climate,
    targets,
    setTargets,
    suggestion,
    months,
    monthIndex: mi,
    month: months[mi] ?? "",
    setMonthIndex,
    playing,
    setPlaying,
    speed,
    setSpeed,
    reducedMotion,
    values,
    window: window_,
    yearRange,
    setWindow,
    sequence,
    tairColour,
    setTairColour,
    colorBy,
    orbVariant,
    setOrbVariant,
    leaders,
    setLeaders,
    selectedLead,
    setSelectedLead,
    layer,
    setLayer,
    onZoomChange,
    overlay,
    setOverlay,
    overlayChoices,
    onPick,
    pickStatus,
    pickerOpen,
    openPicker,
    closePicker,
  };
}
