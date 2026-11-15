"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import GlobeCanvas from "@/components/globe/GlobeCanvas";
import type { View } from "@/components/globe/engine";
import { formatMonth } from "@/components/explore/regionUtils";
import { loadCatalog, loadGrid, pickRegions, rasterIndex } from "@/lib/data";
import { errorDetail, researchApi, type Period, type ResearchResult, type VariableResult } from "@/lib/research";
import type { Catalog, RegionType } from "@/lib/types";
import styles from "./TrendEarth.module.css";

type PeerLayer = "basin3" | "ice" | "lme";

interface SpatialRegion {
  region_id: string;
  name: string;
  centroid: [number, number] | null;
  slope_per_decade: number | null;
}

interface SpatialResult {
  study_id: string;
  variable_id: string;
  product_id: string | null;
  unit: string;
  period: Period | null;
  selected: SpatialRegion & { layer: RegionType | null };
  layer: PeerLayer | null;
  total_regions: number;
  regions: SpatialRegion[];
  reason: string | null;
}

const layerNames: Record<PeerLayer, string> = {
  basin3: "river basins", ice: "ice regions", lme: "large marine ecosystems",
};

function signed(value: number) {
  return value.toLocaleString("en-US", { maximumSignificantDigits: 3, signDisplay: "exceptZero" });
}

function EarthPanel({ studyId, variable }: { studyId: string; variable: VariableResult }) {
  const title = useId();
  const selectorId = useId();
  const [spatial, setSpatial] = useState<SpatialResult | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [problem, setProblem] = useState("");
  const [geometryProblem, setGeometryProblem] = useState(false);
  const [mapInteractive, setMapInteractive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [inspectedId, setInspectedId] = useState("");
  const [focusAt, setFocusAt] = useState<View>();
  const [pickNote, setPickNote] = useState("");
  const pickToken = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setProblem("");
    setGeometryProblem(false);
    void researchApi<SpatialResult>(
      `/api/research/${encodeURIComponent(studyId)}/spatial?variable=${encodeURIComponent(variable.variable_id)}`,
      { signal: controller.signal },
    ).then(response => {
      if (controller.signal.aborted) return;
      if (response.study_id !== studyId || response.variable_id !== variable.variable_id) {
        setProblem("The map did not match this study and variable.");
        return;
      }
      setSpatial(response);
    }).catch(error => { if (!controller.signal.aborted) setProblem(errorDetail(error).message); });
    void loadCatalog().then(value => {
      if (!controller.signal.aborted) setCatalog(value);
    }).catch(() => { if (!controller.signal.aborted) setGeometryProblem(true); });
    return () => { controller.abort(); pickToken.current++; };
  }, [studyId, variable.variable_id, attempt]);

  const overlay = useMemo(() => {
    if (!spatial) return;
    const slopes = new Map<string, number>();
    for (const row of spatial.regions) {
      if (row.slope_per_decade != null && Number.isFinite(row.slope_per_decade)) slopes.set(row.region_id, row.slope_per_decade);
    }
    const magnitudes = Array.from(slopes.values(), Math.abs);
    if (!slopes.has(spatial.selected.region_id) && spatial.selected.slope_per_decade != null) {
      magnitudes.push(Math.abs(spatial.selected.slope_per_decade));
    }
    magnitudes.sort((a, b) => a - b);
    const percentile = magnitudes[Math.max(0, Math.ceil(0.95 * magnitudes.length) - 1)];
    const limit = percentile || magnitudes.at(-1) || 0;
    return { layer: spatial.layer, slopes, limit, selectedSlope: spatial.selected.slope_per_decade };
  }, [spatial]);

  const regionList = useMemo(() => {
    const list = new Map<string, SpatialRegion>();
    if (!spatial) return list;
    if (spatial.layer && catalog) {
      for (const region of catalog.regions) {
        if (region.type !== spatial.layer) continue;
        list.set(region.id, { region_id: region.id, name: region.name, centroid: region.centroid, slope_per_decade: null });
      }
    }
    for (const peer of spatial.regions) list.set(peer.region_id, peer);
    list.set(spatial.selected.region_id, spatial.selected);
    return list;
  }, [spatial, catalog]);

  const options = useMemo(() => [...regionList.values()].filter(r => r.region_id !== spatial?.selected.region_id)
    .sort((a, b) => a.name.localeCompare(b.name, "en")), [regionList, spatial]);

  const selected = spatial?.selected;
  const inspected = regionList.get(inspectedId) ?? selected;
  const slope = inspected?.slope_per_decade;
  const studyBoundary = selected?.layer && catalog?.byId.get(selected.region_id);
  const period = spatial?.period ?? variable.analysis_period;
  const unit = spatial?.unit || variable.unit || "";
  const product = variable.product?.label || spatial?.product_id || variable.product?.selected_product_id;

  function inspect(id: string, center: boolean) {
    pickToken.current++;
    setPickNote("");
    setInspectedId(id);
    const coords = regionList.get(id)?.centroid;
    if (center && coords) setFocusAt({ lon: coords[0], lat: coords[1], zoom: 1 });
  }

  async function pick({ lon, lat, zoom }: { lon: number; lat: number; zoom: number }) {
    if (!spatial || !catalog) return;
    const token = ++pickToken.current;
    try {
      const i = rasterIndex(lon, lat);
      const selectedLayer = spatial.selected.layer;
      let studyHit = false;
      if (studyBoundary && selectedLayer === "named") {
        const hit = await pickRegions(lon, lat, zoom);
        studyHit = [hit.primary, ...hit.alternatives].some(r => r?.id === studyBoundary.id);
      } else if (studyBoundary?.gridIndex && studyBoundary.type !== "named") {
        studyHit = (await loadGrid(studyBoundary.type))[i] === studyBoundary.gridIndex;
      }
      const peer = !studyHit && spatial.layer
        ? catalog.byGrid[spatial.layer][(await loadGrid(spatial.layer))[i]]
        : null;
      if (token !== pickToken.current) return;
      if (studyHit || peer) inspect(studyHit ? spatial.selected.region_id : peer!.id, false);
      else setPickNote("No comparison boundary here. Select a mapped region.");
    } catch {
      if (token === pickToken.current) setPickNote("Boundary lookup failed. Use the region list.");
    }
  }

  return (
    <section className={styles.section} aria-labelledby={title}>
      <header className={styles.header}>
        <h3 id={title}>Trend on Earth</h3>
        <p>{variable.label}{period && <> · {formatMonth(period.start, true)} – {formatMonth(period.end, true)}</>}{product && <> · {product}</>}</p>
      </header>
      {problem ? <div role="alert" className={styles.notice}>{problem} <button type="button" className="text-button" onClick={() => setAttempt(a => a + 1)}>Retry map</button></div>
      : !spatial || !overlay ? <p role="status" className={styles.notice}>Computing comparable regional trends…</p>
      : <div className={styles.layout}>
        <div className={styles.mapColumn}>
          <div className={styles.stage}>
            {geometryProblem ? <p className={styles.stageNote}>Map boundaries could not load. Inspect the estimates in the region list. <button type="button" className="text-button" onClick={() => setAttempt(a => a + 1)}>Retry</button></p>
            : !catalog ? <p className={styles.stageNote}>Loading Earth boundaries…</p>
            : <GlobeCanvas
                className={styles.globe}
                selected={studyBoundary || null}
                boundaryLayer={spatial.layer}
                regionalOverlay={overlay}
                initialView={{ lon: selected?.centroid?.[0] ?? 15, lat: selected?.centroid?.[1] ?? 18, zoom: 1 }}
                focusAt={focusAt}
                inspectedGridIndex={inspectedId && inspectedId !== selected?.region_id ? catalog.byId.get(inspectedId)?.gridIndex : undefined}
                motionPaused
                onInteractiveChange={setMapInteractive}
                onPick={pick}
                ariaLabel="Earth trend map. Drag or use arrow keys to rotate. Click a region or press Enter at the centre to inspect. Use plus and minus to zoom."
              />}
          </div>
          <p className={styles.hint} role="status">{pickNote || (mapInteractive ? "Drag to rotate. Select a region to inspect its trend." : "Use the region list to inspect trends.")}</p>
        </div>
        <div className={styles.info}>
          {spatial.layer && <p className={styles.coverage}><strong>{spatial.regions.length} of {spatial.total_regions}</strong> {layerNames[spatial.layer]} have a comparable trend.</p>}
          {spatial.reason && <p className={styles.coverage}>{spatial.reason}</p>}
          <div>
            <label htmlFor={selectorId}>Inspect a region</label>
            <select id={selectorId} value={inspected?.region_id ?? ""} onChange={e => inspect(e.target.value, true)}>
              <option value={spatial.selected.region_id}>{spatial.selected.name} (study region)</option>
              {options.map(region => <option key={region.region_id} value={region.region_id}>{region.name}{region.slope_per_decade == null ? " — no estimate" : ""}</option>)}
            </select>
          </div>
          <div aria-live="polite" className={styles.readout}>
            <span>{inspected?.name}</span>
            <strong>{slope == null ? "No estimate" : signed(slope)}</strong>
            {slope != null && <span>{unit} per decade</span>}
          </div>
          {(overlay.slopes.size > 0 || overlay.selectedSlope != null) && <div className={styles.legend} aria-label="Regional trend color scale">
            {overlay.limit > 0 ? <>
              <p>{unit} per decade</p>
              <div className={styles.directions}><span>Decreasing</span><span>Increasing</span></div>
              <div className={styles.gradient} />
              <div className={styles.ticks}><span>≤ {signed(-overlay.limit)}</span><span>0</span><span>≥ {signed(overlay.limit)}</span></div>
            </> : <p>All estimated changes are zero.</p>}
            <div className={styles.keys}><span><i className={styles.missing} />No estimate</span><span><i className={styles.outside} />Outside comparison layer</span>{studyBoundary && <span><i className={styles.outline} />Study boundary</span>}</div>
          </div>}
        </div>
      </div>}
    </section>
  );
}

export default function TrendEarth({ result, variable }: { result: ResearchResult; variable: VariableResult }) {
  return <EarthPanel key={result.identity.id + "/" + variable.variable_id} studyId={result.identity.id} variable={variable} />;
}
