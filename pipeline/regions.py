"""Shared helpers: regrid a field to the 0.5 deg mask grid and average it over every region.

Mask: data/masks/regions_0p5.npz (lat -89.75..89.75 ascending, lon -179.75..179.75).
Region order = basin3, basin4, ice, lme, sea, named (hex has no series files, so it is skipped).
Weights = cos(lat). A region-month is valid only when finite cells cover >= MIN_COVER of the
region's area; otherwise it is NaN (written to JSON as null, never 0).

Per-layer intermediate output (written by every product script, merged by merge_series.py):
  data/interim/layers/<layer>.npz
    ids[R] str, start "YYYY-MM", series[R, T] float32 (NaN = missing), coverage[R] float32,
    meta = JSON string {name, category, product, nasa, family, unit, visual, caveat, source, ...}
"""
import json, os
import numpy as np

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASK = os.path.join(REPO, "data", "masks", "regions_0p5.npz")
LAYER_DIR = os.path.join(REPO, "data", "interim", "layers")
MIN_COVER = 0.30
FLAT_TYPES = ("basin3", "basin4", "ice", "lme", "sea")
LAT = -89.75 + 0.5 * np.arange(360)
LON = -179.75 + 0.5 * np.arange(720)


class Regions:
    def __init__(self, mask=MASK):
        m = np.load(mask)
        assert m["lat"].size == 360 and abs(m["lat"][0] + 89.75) < 1e-6
        self.w = np.repeat(np.cos(np.deg2rad(LAT))[:, None], 720, 1).ravel()
        ids, self._parts = [], []
        for t in FLAT_TYPES:
            a = m[t].ravel(); tid = [str(x) for x in m[f"{t}_ids"]]
            self._parts.append(("flat", len(ids), a, len(tid))); ids += tid
        named = m["named"].reshape(m["named"].shape[0], -1)
        nid = [str(x) for x in m["named_ids"]]
        self._parts.append(("named", len(ids), named.astype(np.float64), len(nid))); ids += nid
        self.ids = ids
        self.total_w = self._sum(np.ones(360 * 720))

    def _sum(self, x):
        """sum over each region of x * w; x is (259200,)"""
        out = np.zeros(len(self.ids))
        xw = x * self.w
        for kind, off, a, n in self._parts:
            if kind == "flat":
                ok = a >= 0
                out[off:off + n] = np.bincount(a[ok], weights=xw[ok], minlength=n)
            else:
                out[off:off + n] = a @ xw
        return out

    def mean(self, field):
        """field (360, 720) on the mask grid -> (mean[R], cover_frac[R]); NaN where cover < MIN_COVER"""
        x = np.asarray(field, np.float64).ravel(); ok = np.isfinite(x)
        s = self._sum(np.where(ok, x, 0.0)); c = self._sum(ok.astype(np.float64))
        with np.errstate(invalid="ignore", divide="ignore"):
            frac = np.where(self.total_w > 0, c / self.total_w, 0.0)
            mean = np.where((frac >= MIN_COVER) & (c > 0), s / np.maximum(c, 1e-300), np.nan)
        return mean.astype(np.float32), frac.astype(np.float32)


def to_half_degree(field, lat, lon):
    """Put a regular lat/lon grid onto the 0.5 deg mask grid.

    finer grid with integer ratio (0.25, 0.1, 0.05 deg) -> NaN-aware block mean;
    anything else (1 deg, MERRA-2 0.5x0.625 with pole points) -> nearest neighbour.
    lat may be descending; lon may be 0..360."""
    f = np.asarray(field, np.float64); lat = np.asarray(lat, np.float64); lon = np.asarray(lon, np.float64)
    if lat[0] > lat[-1]:
        f = f[::-1]; lat = lat[::-1]
    lon = np.where(lon >= 180, lon - 360, lon)
    order = np.argsort(lon); f = f[:, order]; lon = lon[order]
    dy = np.median(np.diff(lat)); dx = np.median(np.diff(lon))
    ky, kx = 0.5 / dy, 0.5 / dx
    regular = (abs(lat[0] - (-90 + dy / 2)) < 1e-3 and abs(lon[0] - (-180 + dx / 2)) < 1e-3)
    if regular and ky >= 1 and kx >= 1 and abs(ky - round(ky)) < 1e-6 and abs(kx - round(kx)) < 1e-6:
        ky, kx = int(round(ky)), int(round(kx))
        b = f.reshape(360, ky, 720, kx)
        ok = np.isfinite(b)
        cnt = ok.sum((1, 3)); tot = np.where(ok, b, 0.0).sum((1, 3))
        return np.where(cnt > 0, tot / np.maximum(cnt, 1), np.nan)
    iy = np.clip(np.searchsorted(lat, LAT), 1, lat.size - 1)
    iy = np.where(np.abs(lat[iy - 1] - LAT) <= np.abs(lat[iy] - LAT), iy - 1, iy)
    lon_ext = np.concatenate([lon[-1:] - 360, lon, lon[:1] + 360])
    ix = np.clip(np.searchsorted(lon_ext, LON), 1, lon_ext.size - 1)
    ix = np.where(np.abs(lon_ext[ix - 1] - LON) <= np.abs(lon_ext[ix] - LON), ix - 1, ix)
    ix = (ix - 1) % lon.size
    return f[np.ix_(iy, ix)]


def month_index(start, ym):
    y0, m0 = map(int, start.split("-")); y, m = map(int, ym.split("-"))
    return (y - y0) * 12 + (m - m0)


def save_layer(layer, regions, months, fields_or_series, meta, cover=None):
    """months: sorted list of 'YYYY-MM' (gaps allowed); fields_or_series: list of (360,720) grids
    or an already-averaged array (R, len(months)). Writes data/interim/layers/<layer>.npz."""
    os.makedirs(LAYER_DIR, exist_ok=True)
    start, end = months[0], months[-1]
    T = month_index(start, end) + 1
    series = np.full((len(regions.ids), T), np.nan, np.float32)
    covers = np.zeros(len(regions.ids), np.float32) if cover is None else cover
    if isinstance(fields_or_series, np.ndarray) and fields_or_series.ndim == 2 and \
            fields_or_series.shape[0] == len(regions.ids):
        for k, ym in enumerate(months):
            series[:, month_index(start, ym)] = fields_or_series[:, k]
    else:
        for ym, fld in zip(months, fields_or_series):
            mu, fr = regions.mean(fld)
            series[:, month_index(start, ym)] = mu
            covers = np.maximum(covers, fr)
    np.savez_compressed(os.path.join(LAYER_DIR, f"{layer}.npz"), ids=np.array(regions.ids), start=start,
                        series=series, coverage=covers, meta=json.dumps(meta, ensure_ascii=False))
    return series
