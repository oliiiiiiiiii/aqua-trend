"use client";
import dynamic from "next/dynamic";
import { memo, useCallback, useState } from "react";
import type { GlobePoint } from "@/lib/contracts";
import type { LayerId, Region, VarId } from "@/lib/types";
import { LAYER_LABEL } from "@/lib/data";
import { VARIABLES } from "@/lib/variables";
import { Segmented } from "./Segmented";

const GlobeCanvas = dynamic(() => import("@/components/globe/GlobeCanvas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-on-stage-2" role="status">
      Loading the globe…
    </div>
  ),
});

export type PickableLayer = "basin3" | "basin4" | "hex" | "lme";
export const LAYER_OPTIONS: { value: PickableLayer; label: string; title: string }[] = [
  { value: "basin3", label: "Large basins", title: "River basins, level 3 (292)" },
  { value: "basin4", label: "Sub-basins", title: "River basins, level 4 (1,342)" },
  { value: "hex", label: "Hexagons", title: "Global H3 grid, resolution 2 (5,882)" },
  { value: "lme", label: "Marine regions", title: "Large marine ecosystems (66)" },
];

/** The interactive planet with its layer and overlay controls. */
export const GlobePane = memo(function GlobePane({
  layer,
  onLayerChange,
  selected,
  overlay,
  onOverlayChange,
  overlayChoices,
  onPick,
  onZoomChange,
  pickStatus,
  canvasClassName,
}: {
  layer: PickableLayer;
  onLayerChange: (l: PickableLayer) => void;
  selected: Region | null;
  overlay: VarId | null;
  onOverlayChange: (v: VarId | null) => void;
  /** variables offered as trend-map overlays (the selected targets); empty hides the control */
  overlayChoices: VarId[];
  onPick: (p: GlobePoint & { zoom: number }) => void;
  onZoomChange: (z: number) => void;
  pickStatus: string;
  canvasClassName: string;
}) {
  const [hover, setHover] = useState<Region | null>(null);
  const onHover = useCallback((hit: (GlobePoint & { region: Region | null }) | null) => {
    const r = hit?.region ?? null;
    setHover((prev) => (prev?.id === r?.id ? prev : r));
  }, []);
  const overlayValue = overlay ?? "landscape";

  return (
    <div className="on-stage flex min-w-0 flex-col gap-3">
      <div className={canvasClassName}>
        <GlobeCanvas
          className="h-full w-full"
          interactive
          boundaryLayer={layer as LayerId}
          selected={selected}
          overlay={overlay}
          onPick={onPick}
          onHover={onHover}
          onZoomChange={onZoomChange}
        />
      </div>
      <p className="sr-only" aria-live="polite">{pickStatus}</p>
      <p className="min-h-[1.5rem] text-center text-sm text-on-stage-2">
        {pickStatus ||
          (hover ? (
            <>
              <span className="sr-only">Pointer over </span>
              <span className="font-semibold text-on-stage">{hover.name}</span>, {LAYER_LABEL[hover.type].toLowerCase()}. Click to select.
            </>
          ) : (
            "Drag to turn the planet, scroll or pinch to zoom, click a region to select it."
          ))}
      </p>
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-center">
        <Segmented
          legend="Boundaries drawn on the globe"
          options={LAYER_OPTIONS}
          value={layer}
          onChange={onLayerChange}
          gridOnMobile
        />
        {overlayChoices.length > 0 && (
          <label className="flex flex-col items-center text-sm text-on-stage-2">
            <span className="mb-1.5">Globe surface</span>
            <select
              value={overlayValue}
              onChange={(e) => onOverlayChange(e.target.value === "landscape" ? null : (e.target.value as VarId))}
              className="rounded-ctl border border-stage-line bg-stage px-3 py-1.5 text-sm text-on-stage"
            >
              <option value="landscape">Landscape (illustrative)</option>
              {overlayChoices.map((v) => (
                <option key={v} value={v}>
                  Trend map: {VARIABLES[v].label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
});
