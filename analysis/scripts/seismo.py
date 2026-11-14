"""seismo - small earthquake-statistics toolkit for tasks 40-43.

* load(name): catalogue from data/processed/eq/<name>.csv.gz -> DataFrame(time, lat, lon, depth, mag, place)
* decluster_gk(df): Gardner & Knopoff (1974) window declustering (largest-first, Type-1 / OpenQuake style)
* mc_maxc(m): magnitude of completeness, maximum-curvature + 0.2 correction (Woessner & Wiemer 2005)
* bvalue(m, mc): Aki (1965) / Utsu b-value with Shi & Bolt (1982) standard error
* rate_trend(years, counts): quasi-Poisson GLM trend in an annual count series (+ Mann-Kendall)
* rate_ratio(n1, T1, n2, T2): exact conditional (binomial) test for a change in Poisson rate
* schuster(phases): Schuster test for periodicity (e.g. annual) of event times
"""
import math
import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))


def load(name, minmag=None):
    if name == "gcmt":
        df = pd.read_csv(f"{ROOT}/data/processed/eq/gcmt.csv.gz")
        df = df.rename(columns={"latitude": "lat", "longitude": "lon", "mw": "mag"})
        df["time"] = pd.to_datetime(df["time"], format="mixed", errors="coerce")
        df["place"] = df["name"]
    else:
        df = pd.read_csv(f"{ROOT}/data/processed/eq/{name}.csv.gz", usecols=["time", "latitude", "longitude", "depth", "mag", "magType", "id", "place"])
        df = df.rename(columns={"latitude": "lat", "longitude": "lon"})
        df["time"] = pd.to_datetime(df["time"], utc=True).dt.tz_localize(None)
    df = df.dropna(subset=["time", "mag", "lat", "lon"]).sort_values("time").reset_index(drop=True)
    if minmag is not None:
        df = df[df.mag >= minmag - 1e-9].reset_index(drop=True)
    return df


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.deg2rad(lat1), np.deg2rad(lat2)
    dl = np.deg2rad(lon2 - lon1)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def gk_windows(m):
    L = 10 ** (0.1238 * m + 0.983)                                         # km
    T = np.where(m >= 6.5, 10 ** (0.032 * m + 2.7389), 10 ** (0.5409 * m - 0.547))  # days
    return L, T


def decluster_gk(df, fs_time_prop=1.0):
    """Return boolean array: True = mainshock (independent event). Foreshock window = fs_time_prop x aftershock window."""
    t = (df.time.values - np.datetime64("1900-01-01")) / np.timedelta64(1, "D")
    t = t.astype(float); lat = df.lat.values; lon = df.lon.values; m = df.mag.values.astype(float)
    n = len(df)
    L, T = gk_windows(m)
    order = np.argsort(-m, kind="stable")
    dep = np.zeros(n, bool)
    # df is time-sorted
    for i in order:
        if dep[i]:
            continue
        lo = np.searchsorted(t, t[i] - fs_time_prop * T[i], "left")
        hi = np.searchsorted(t, t[i] + T[i], "right")
        if hi - lo <= 1:
            continue
        j = np.arange(lo, hi)
        j = j[(j != i) & ~dep[j] & (m[j] <= m[i])]
        if len(j) == 0:
            continue
        d = haversine_km(lat[i], lon[i], lat[j], lon[j])
        dep[j[d <= L[i]]] = True
    return ~dep


def mc_maxc(m, dm=0.1, corr=0.2):
    m = np.asarray(m)
    if len(m) < 50:
        return np.nan
    bins = np.round(m / dm) * dm
    v, c = np.unique(np.round(bins, 2), return_counts=True)
    return float(v[np.argmax(c)] + corr)


def bvalue(m, mc, dm=0.1):
    x = np.asarray(m)
    x = x[x >= mc - dm / 2 + 1e-9]
    n = len(x)
    if n < 30:
        return np.nan, np.nan, n
    b = math.log10(math.e) / (x.mean() - (mc - dm / 2))
    se = 2.3 * b ** 2 * math.sqrt(np.sum((x - x.mean()) ** 2) / (n * (n - 1)))
    return float(b), float(se), n


def rate_trend(years, counts, per=10.0):
    """Quasi-Poisson log-linear trend. Returns % change per `per` years, CI, p, dispersion, Mann-Kendall p."""
    y = np.asarray(counts, float); x = np.asarray(years, float)
    X = sm.add_constant(x - x.mean())
    g = sm.GLM(y, X, family=sm.families.Poisson()).fit()
    phi = max(float(g.pearson_chi2 / g.df_resid), 1.0)
    b, se = g.params[1], g.bse[1] * math.sqrt(phi)
    z = b / se
    p = float(2 * stats.norm.sf(abs(z)))
    mk = stats.kendalltau(x, y)
    pct = lambda v: float((math.exp(per * v) - 1) * 100)
    return dict(pct_per_decade=pct(b), ci_lo=pct(b - 1.96 * se), ci_hi=pct(b + 1.96 * se), p=p, dispersion=phi,
                mk_tau=float(mk.statistic), mk_p=float(mk.pvalue), mean=float(y.mean()), n_years=int(len(y)))


def rate_ratio(n1, T1, n2, T2):
    """Exact conditional test that the Poisson rate in period 2 equals period 1. Returns ratio, 95% CI, two-sided p."""
    n = n1 + n2
    if n == 0:
        return dict(ratio=np.nan, lo=np.nan, hi=np.nan, p=1.0)
    p0 = T2 / (T1 + T2)
    p = float(stats.binomtest(int(n2), int(n), p0).pvalue)
    # CI for the binomial proportion -> rate ratio
    ci = stats.binomtest(int(n2), int(n), p0).proportion_ci(0.95, method="exact")
    f = lambda q: (q / (1 - q)) * (T1 / T2) if 0 < q < 1 else (np.inf if q >= 1 else 0.0)
    r = (n2 / T2) / (n1 / T1) if n1 > 0 else np.inf
    return dict(ratio=float(r), lo=float(f(ci.low)), hi=float(f(ci.high)), p=p)


def schuster(phase):
    """phase in radians (e.g. 2*pi*day_of_year/365.25). Returns (p, mean resultant direction rad, amplitude R/N)."""
    c, s = np.cos(phase).sum(), np.sin(phase).sum()
    n = len(phase)
    R2 = c ** 2 + s ** 2
    return float(math.exp(-R2 / n)), float(math.atan2(s, c)), float(math.sqrt(R2) / n)


def omori_fit(t_days, t_max):
    """MLE fit of the modified Omori (Omori-Utsu) law n(t) = K/(t+c)^p to aftershock times t in (0, t_max] days (Ogata 1983)."""
    from scipy.optimize import minimize
    t = np.asarray(t_days, float)
    t = t[(t > 0) & (t <= t_max)]

    def integ(K, c, p):
        if abs(p - 1) < 1e-6:
            return K * (math.log(t_max + c) - math.log(c))
        return K * ((t_max + c) ** (1 - p) - c ** (1 - p)) / (1 - p)

    def nll(th):
        lK, lc, p = th
        K, c = math.exp(lK), math.exp(lc)
        if not (0.3 < p < 2.5):
            return 1e12
        return -(len(t) * lK - p * np.sum(np.log(t + c))) + integ(K, c, p)

    best = None
    for p0 in (0.9, 1.1, 1.3):
        for c0 in (0.01, 0.1, 0.5):
            r = minimize(nll, [math.log(len(t) / 5), math.log(c0), p0], method="Nelder-Mead", options=dict(maxiter=5000, xatol=1e-6, fatol=1e-6))
            if best is None or r.fun < best.fun:
                best = r
    lK, lc, p = best.x
    return dict(K=float(math.exp(lK)), c=float(math.exp(lc)), p=float(p), n=int(len(t)))
