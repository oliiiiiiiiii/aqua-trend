"""viz - consistent, presentation-quality figures for trend results.

Palette follows the dataviz reference instance:
  surface #fcfcfb, ink #0b0b0b / #52514e / muted #898781, grid #e1e0d9
  diverging = blue <-> red (or blue <-> orange for water) with neutral gray midpoint #f0efec
"""
from __future__ import annotations

import textwrap
import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm  # noqa: E402

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
AXIS = "#c3c2b7"
MID = "#f0efec"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]

BLUE_ARM = ["#0d366b", "#1c5cab", "#2a78d6", "#6da7ec", "#b7d3f6"]
RED_ARM = ["#f6c9c2", "#f09d92", "#e34948", "#b8302f", "#7f1d1d"]
ORANGE_ARM = ["#f8d0bd", "#f2a27e", "#eb6834", "#b84a1f", "#7a2e10"]
GREEN_ARM = ["#c9ecc9", "#8fd18f", "#2e9e2e", "#0f6e0f", "#064a06"]
BROWN_ARM = ["#4a2a0e", "#7a4a1d", "#a8733d", "#d2aa78", "#efdcc0"]

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "text.color": INK, "axes.labelcolor": INK2, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.edgecolor": AXIS, "font.size": 11, "axes.titlesize": 14, "font.family": "DejaVu Sans",
})


def div_cmap(kind: str = "redblue"):
    """Diverging colormap; low end first.
    redblue : decrease=blue, increase=red (pollution, temperature)
    bluered : decrease=red, increase=blue (rare)
    water   : decrease=orange (drying), increase=blue (wetting)
    green   : decrease=brown (browning), increase=green (greening)
    """
    if kind == "redblue":
        cols = BLUE_ARM + [MID] + RED_ARM
    elif kind == "bluered":
        cols = RED_ARM[::-1] + [MID] + BLUE_ARM[::-1]
    elif kind == "water":
        cols = ORANGE_ARM[::-1] + [MID] + BLUE_ARM[::-1]
    elif kind == "green":
        cols = BROWN_ARM + [MID] + GREEN_ARM
    else:
        raise ValueError(kind)
    return LinearSegmentedColormap.from_list(kind, cols, N=256)


def _robust_vmax(field, sig=None, q=98):
    f = np.asarray(field, float)
    if sig is not None and np.any(sig & np.isfinite(f)):
        f = f[sig & np.isfinite(f)]
    else:
        f = f[np.isfinite(f)]
    if f.size == 0:
        return 1.0
    v = np.nanpercentile(np.abs(f), q)
    if v == 0:
        v = np.nanmax(np.abs(f)) or 1.0
    # round to a "nice" number
    e = 10 ** np.floor(np.log10(v))
    for m in (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if v <= m * e:
            return m * e
    return v


def trend_map(lon, lat, field, sig, out, title, subtitle="", cbar_label="", vmax=None, cmap="redblue",
              extent=None, proj="robinson", fade=0.30, figsize=None, dpi=200, source="",
              boxes=None, labels=None, land_mask=None, ocean=False, central_lon=0):
    """Map a trend field. Non-significant pixels are drawn faded; significant at full strength.

    lon, lat: 1-D ascending coordinate arrays (cell centres); field/sig: (lat, lon).
    boxes: list of (lon0, lon1, lat0, lat1, label) rectangles to outline.
    """
    import cartopy.crs as ccrs
    import cartopy.feature as cfeature
    lon = np.asarray(lon); lat = np.asarray(lat)
    field = np.asarray(field, float)
    sig = np.zeros_like(field, bool) if sig is None else np.asarray(sig, bool)
    if vmax is None:
        vmax = _robust_vmax(field, sig)
    cm = div_cmap(cmap) if isinstance(cmap, str) else cmap
    if proj == "robinson":
        pr = ccrs.Robinson(central_longitude=central_lon)
        figsize = figsize or (12, 6.6)
    else:
        pr = ccrs.PlateCarree(central_longitude=central_lon)
        if figsize is None:
            if extent is not None:
                w = extent[1] - extent[0]; h = extent[3] - extent[2]
                figsize = (10, max(4.5, min(11, 10 * h / w + 1.6)))
            else:
                figsize = (12, 6.6)
    fig = plt.figure(figsize=figsize, dpi=dpi)
    ax = fig.add_axes([0.02, 0.17, 0.96, 0.68], projection=pr)
    if extent is not None:
        ax.set_extent(extent, crs=ccrs.PlateCarree())
    else:
        ax.set_global()
    dlon = float(np.median(np.diff(lon))) if lon.size > 1 else 1
    dlat = float(np.median(np.diff(lat))) if lat.size > 1 else 1
    ext = [lon[0] - dlon / 2, lon[-1] + dlon / 2, lat[0] - dlat / 2, lat[-1] + dlat / 2]
    kw = dict(origin="lower", extent=ext, transform=ccrs.PlateCarree(), cmap=cm, vmin=-vmax, vmax=vmax,
              interpolation="nearest")
    if lon.size * lat.size > 2_000_000:
        kw["regrid_shape"] = 2000
    ax.imshow(np.where(np.isfinite(field), field, np.nan), alpha=fade, **kw)
    im = ax.imshow(np.where(sig & np.isfinite(field), field, np.nan), **kw)
    ax.add_feature(cfeature.COASTLINE.with_scale("50m" if extent else "110m"), linewidth=0.5, edgecolor=INK2)
    ax.add_feature(cfeature.BORDERS.with_scale("50m" if extent else "110m"), linewidth=0.3, edgecolor=MUTED)
    if ocean:
        ax.add_feature(cfeature.LAND.with_scale("110m"), facecolor="#e9e8e3", zorder=0)
    try:
        ax.spines["geo"].set_edgecolor(AXIS)
    except Exception:
        pass
    if boxes:
        for b in boxes:
            lon0, lon1, lat0, lat1 = b[:4]
            ax.plot([lon0, lon1, lon1, lon0, lon0], [lat0, lat0, lat1, lat1, lat0], color=INK, lw=0.9,
                    transform=ccrs.PlateCarree())
            if len(b) > 4 and b[4]:
                ax.text(lon0 + 0.02 * (lon1 - lon0) + 0.1, lat1 - 0.1, b[4], fontsize=8, color=INK,
                        transform=ccrs.PlateCarree(), ha="left", va="top", clip_on=True,
                        bbox=dict(boxstyle="round,pad=0.15", fc=SURFACE, ec="none", alpha=0.8))
    wrapw = int(11.5 * figsize[0])  # characters per line at fontsize ~10.5 (DejaVu ~0.55 em per char)
    fig.text(0.03, 0.955, title, fontsize=15, fontweight="bold", color=INK, ha="left", va="top")
    if subtitle:
        fig.text(0.03, 0.905, "\n".join(textwrap.wrap(subtitle, wrapw)), fontsize=10.5 if len(subtitle) < 2 * wrapw else 9.5,
                 color=INK2, ha="left", va="top")
    cax = fig.add_axes([0.30, 0.115, 0.40, 0.022])
    cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both")
    cb.outline.set_visible(False)
    cb.ax.tick_params(labelsize=9, colors=INK2, length=0)
    cb.set_label(cbar_label, fontsize=10, color=INK2)
    note = "Faded = not significant (FDR q=0.10).  " + (source or "")
    fig.text(0.03, 0.012, "\n".join(textwrap.wrap(note, int(15.5 * figsize[0]))), fontsize=7.5, color=MUTED, ha="left", va="bottom")
    fig.savefig(out, dpi=dpi)
    plt.close(fig)
    return out


def ts_figure(s: pd.Series, out, title, units, st: dict | None = None, rolling=12, color=SERIES[0],
              subtitle="", source="", events=None, ylabel=None, figsize=(11, 4.6), dpi=170, show_trend=True,
              show_pct=True):
    """Monthly series: thin raw line, bold 12-month running mean, OLS trend line + stats box."""
    from trendlib import decimal_year
    s = s.dropna()
    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    fig.subplots_adjust(left=0.08, right=0.98, top=0.80, bottom=0.12)
    ax.plot(s.index, s.values, color=MUTED, lw=0.8, alpha=0.75, label="monthly")
    if rolling and len(s) > rolling:
        r = s.rolling(rolling, center=True, min_periods=int(rolling * 0.75)).mean()
        ax.plot(r.index, r.values, color=color, lw=2.2, label=f"{rolling}-month mean")
    if show_trend and st and st.get("slope_per_decade") is not None and np.isfinite(st.get("slope_per_decade", np.nan)):
        t = decimal_year(s.index)
        b = st["slope_per_decade"] / 10.0
        line = s.mean() + b * (t - t.mean())
        ax.plot(s.index, line, color="#e34948", lw=2, ls="--", label="linear trend")
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.grid(axis="y", color=GRID, lw=0.6)
    ax.tick_params(length=0)
    ax.set_ylabel(ylabel or units, color=INK2)
    if events:
        for d, lab in events:
            ax.axvline(pd.Timestamp(d), color=AXIS, lw=1, ls=":")
            ax.text(pd.Timestamp(d), ax.get_ylim()[1], " " + lab, fontsize=8, color=INK2, va="top")
    fig.text(0.08, 0.965, title, fontsize=14, fontweight="bold", ha="left", va="top")
    sub = subtitle
    if st and "slope_per_decade" in st:
        pct = st.get("pct_per_decade")
        pcts = f" ({pct:+.1f}%/decade)" if show_pct and pct is not None and np.isfinite(pct) else ""
        sub2 = (f"Trend {st['slope_per_decade']:+.3g} ± {st['ci95_per_decade']:.2g} {units}/decade{pcts}   "
                f"p(OLS-AR1)={st['p_ols_ar1']:.2g}   p(MK-HR)={st['mk_hr_p']:.2g}   → {st['verdict']}")
        sub = (sub + "\n" if sub else "") + sub2
    if sub:
        fig.text(0.08, 0.905, sub, fontsize=9.5, color=INK2, ha="left", va="top")
    ax.legend(loc="upper left", frameon=False, fontsize=8.5, ncol=3, bbox_to_anchor=(0, 1.02))
    if source:
        fig.text(0.98, 0.01, source, fontsize=7.5, color=MUTED, ha="right", va="bottom")
    fig.savefig(out, dpi=dpi)
    plt.close(fig)
    return out


def multi_ts(series: dict, out, title, units, subtitle="", source="", rolling=12, figsize=(11, 5), dpi=170,
             normalize=False):
    """Several regional series (<=6) on one axis; each direct-labeled at its right end + legend."""
    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    fig.subplots_adjust(left=0.08, right=0.84, top=0.84, bottom=0.10)
    for i, (name, s) in enumerate(series.items()):
        s = s.dropna()
        if normalize:
            base = s.iloc[: max(12, len(s) // 10)].mean()
            s = 100 * s / base
        r = s.rolling(rolling, center=True, min_periods=int(rolling * 0.75)).mean() if rolling else s
        c = SERIES[i % len(SERIES)]
        ax.plot(r.index, r.values, color=c, lw=2, label=name)
        last = r.dropna()
        if len(last):
            ax.text(last.index[-1], last.values[-1], "  " + name, color=INK2, fontsize=8.5, va="center")
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.grid(axis="y", color=GRID, lw=0.6)
    ax.tick_params(length=0)
    ax.set_ylabel(("index (start=100)" if normalize else units), color=INK2)
    ax.legend(loc="upper left", frameon=False, fontsize=8.5, ncol=3, bbox_to_anchor=(0, 1.06))
    fig.text(0.08, 0.975, title, fontsize=14, fontweight="bold", ha="left", va="top")
    if subtitle:
        fig.text(0.08, 0.925, subtitle, fontsize=9.5, color=INK2, ha="left", va="top")
    if source:
        fig.text(0.98, 0.01, source, fontsize=7.5, color=MUTED, ha="right", va="bottom")
    fig.savefig(out, dpi=dpi)
    plt.close(fig)
    return out
