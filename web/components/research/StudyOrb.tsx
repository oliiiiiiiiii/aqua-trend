"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Region } from "@/lib/types";
import { VARIABLES } from "@/lib/variables";
import { cssVar, useThemeId } from "@/lib/theme";
import { chooseScenery, mix, parseColor, type RGB } from "@/components/orb/encoding";
import { NEUTRAL_LEAVES } from "@/components/orb/season";
import type { FrameInput, OrbScene, ThemeInput } from "@/components/orb/scene";
import styles from "./TrendCrystalBalls.module.css";

type Channel = "precip" | "et" | "runoff" | "soil_top" | "root_zone" | "air" | "land" | "ocean" | "leaf" | "gauge";

const channels: Record<string, Channel> = {
  precip: "precip", precip_land: "precip", et: "et", et_land: "et", runoff: "runoff",
  soil_top: "soil_top", soil_root: "root_zone", soil_wetness: "root_zone",
  tair: "air", tsurf: "land", lst_day: "land", sst: "ocean", ndvi: "leaf",
};

const legends: Record<Channel, string> = {
  precip: "Denser falling droplets indicate higher precipitation.",
  et: "Denser rising wisps indicate more water moving into the atmosphere.",
  runoff: "More lateral arrows indicate greater runoff generated on land.",
  soil_top: "A bluer upper soil layer indicates more topsoil water.",
  root_zone: "A bluer root layer indicates wetter soil around the roots.",
  air: "Air color shifts from cool blue to warm orange as temperature increases.",
  land: "Land color shifts from cool blue to warm orange as surface temperature increases.",
  ocean: "Sea color shifts from cool blue to warm orange as surface temperature increases.",
  leaf: "A greener canopy indicates a higher vegetation index.",
  gauge: "",
};

export function orbEncoding(variableId: string) {
  const channel = channels[variableId] ?? "gauge";
  return { channel, legend: legends[channel] };
}

function themeColors(night: boolean): ThemeInput {
  const color = (name: string) => parseColor(cssVar(name));
  return {
    night, cool: color("--viz-cool"), mid: color("--viz-mid"), warm: color("--viz-warm"),
    precip: color("--viz-blue"), runoff: color("--viz-violet"), soilTop: color("--viz-green"),
    rootZone: color("--viz-yellow"), hatchA: color("--viz-grid"), hatchB: color("--viz-axis"),
    rim: [0.93, 0.98, 1],
  };
}

function frameFor(channel: Channel, fraction: number | null, observed: number | null): FrameInput {
  const off = { active: false, missing: false, drawn: 0 };
  const frame: FrameInput = { precip: off, et: off, runoff: off, soil_top: off, root_zone: off, swe: off, tair: null };
  if (channel === "precip" || channel === "et" || channel === "runoff" || channel === "soil_top" || channel === "root_zone") {
    // The old renderer takes a channel-domain value. The study legend instead uses one common low–high scale.
    const flux = channel === "precip" || channel === "et" || channel === "runoff";
    const intensity = flux && observed !== null && observed <= 0 ? 0 : 0.04 + 0.92 * (fraction ?? 0);
    frame[channel] = { active: true, missing: fraction === null, drawn: intensity * VARIABLES[channel].domain[1] };
  }
  return frame;
}

interface Props {
  region: Region | null;
  channel: Channel;
  level: number | null;
  observed: number | null;
  zero: number | null;
  animate: boolean;
}

export default function StudyOrb({ region, channel, level, observed, zero, animate }: Props) {
  const theme = useThemeId();
  const host = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ region: Region; scene: OrbScene } | null>(null);
  const scene = loaded?.region === region ? loaded?.scene : null;
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!region || !container) return;
    let active = true;
    let instance: OrbScene | null = null;
    let resize: ResizeObserver | undefined;
    setLost(false);
    void import("@/components/orb/scene").then(({ OrbScene }) => {
      if (!active) return;
      instance = new OrbScene(container, { compact: true, reducedMotion: true, getAnchor: () => null });
      instance.onContextLost = () => { if (active) setLost(true); };
      instance.setScenery(region.id, chooseScenery(region, null));
      const adjust = () => {
        const { width, height } = container.getBoundingClientRect();
        instance?.setSize(width, height);
      };
      adjust();
      resize = new ResizeObserver(adjust);
      resize.observe(container);
      setLoaded({ region, scene: instance });
    }).catch(() => {
      resize?.disconnect();
      instance?.dispose();
      instance = null;
      if (active) setLost(true);
    });
    return () => {
      active = false;
      resize?.disconnect();
      instance?.dispose();
    };
  }, [region]);

  useEffect(() => {
    if (!scene || lost) return;
    scene.setReducedMotion(!animate);
  }, [animate, scene, lost]);

  useEffect(() => {
    if (!scene || lost) return;
    const palette = themeColors(theme === "night");
    if (level !== null && (channel === "air" || channel === "land" || channel === "ocean")) {
      const cool: RGB = [0.22, 0.57, 0.94];
      const warm: RGB = [1, 0.51, 0.25];
      palette.temperatureTint = { surface: channel, color: mix(cool, warm, level) };
    }
    scene.setTheme(palette);
    scene.setLeaves(channel === "leaf" && level !== null
      ? { ...NEUTRAL_LEAVES, amt: 1, tint: mix([0.68, 0.46, 0.18], [0.04, 0.58, 0.23], level) }
      : NEUTRAL_LEAVES);
    scene.setFrame(frameFor(channel, level, observed), true);
  }, [scene, lost, theme, channel, level, observed]);

  const fallback = !scene || lost || !region;
  const style = { "--level": level ?? 0, "--zero": zero ?? 0 } as CSSProperties;
  return (
    <div className={styles.orb} style={style} aria-hidden="true" data-channel={channel}
      data-renderer={fallback ? "instrument" : "webgl"} data-level={level ?? "missing"}>
      <div className={styles.canvas} ref={host} style={{visibility: fallback ? "hidden" : "visible"}} />
      {fallback && <div className={styles.glass} />}
      {level !== null && (
        <div className={styles.instrument} data-primary={channel === "gauge" || fallback}>
          <div className={styles.track} />
          {zero !== null && <i className={styles.zero} />}
          <i className={styles.indicator} />
        </div>
      )}
      {level === null && <span className={styles.missing}>No data</span>}
    </div>
  );
}
