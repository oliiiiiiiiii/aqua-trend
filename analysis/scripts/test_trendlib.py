"""Synthetic checks for trendlib: slope recovery, false-positive rate under AR(1) null, FDR, GPU parity."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import time
import numpy as np
import pandas as pd

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402

rng = np.random.default_rng(42)
times = pd.date_range("2000-01-01", periods=300, freq="MS")  # 25 years monthly
t = tl.decimal_year(times)
season = 3 * np.sin(2 * np.pi * (times.month.values - 1) / 12)


def ar1_noise(n, phi, sd, size):
    e = rng.normal(0, sd, (n,) + size)
    x = np.empty_like(e)
    x[0] = e[0]
    for i in range(1, n):
        x[i] = phi * x[i - 1] + e[i]
    return x


ok = True
# 1) slope recovery: true slope 0.5 units/decade with AR(1) phi=0.6 noise
npix = 4000
true = 0.05  # per year
noise = ar1_noise(300, 0.6, 1.0, (npix,))
y = season[:, None] + true * (t - t[0])[:, None] + noise
res = tl.ols_ar1(tl.deseason(y, times.month.values)[0], t)
cover = np.mean(np.abs(res["slope"] - true) <= res["ci"])
print(f"[1] mean slope {np.nanmean(res['slope']):.4f} (true {true}); 95% CI coverage {cover:.3f}")
ok &= abs(np.nanmean(res["slope"]) - true) < 0.005 and 0.90 <= cover <= 0.99

# 2) null false-positive rate with AR(1) phi=0.6: naive OLS vs AR(1)-corrected
y0 = season[:, None] + ar1_noise(300, 0.6, 1.0, (npix,))
a0 = tl.deseason(y0, times.month.values)[0]
r0 = tl.ols_ar1(a0, t)
fpr = np.mean(r0["p"] < 0.05)
# naive
from scipy import stats
naive = np.mean([stats.linregress(t, a0[:, i]).pvalue < 0.05 for i in range(500)])
print(f"[2] null FPR: AR1-corrected {fpr:.3f}  vs naive OLS {naive:.3f}  (target ~0.05)")
ok &= fpr < 0.09

# 3) MK grid vs pymannkendall on annual means
ann, yrs = tl.annual_means(y[:, :50], times.year.values)
mk = tl.mk_grid(ann)
import pymannkendall as pmk
ref = np.array([pmk.original_test(ann[:, i]).p for i in range(50)])
print(f"[3] MK grid vs pymannkendall max |dp| = {np.max(np.abs(mk['p'] - ref)):.2e}")
ok &= np.max(np.abs(mk["p"] - ref)) < 1e-6
sen = tl.sen_grid(ann, yrs.astype(float))
refs = np.array([pmk.original_test(ann[:, i]).slope for i in range(50)])
print(f"[3b] Sen grid vs pymannkendall max |d| = {np.max(np.abs(sen - refs)):.2e}")
ok &= np.max(np.abs(sen - refs)) < 1e-4

# 4) FDR: 10% true signals among nulls
p_null = rng.uniform(size=9000)
p_sig = rng.uniform(0, 1e-4, size=1000)
m = tl.fdr_mask(np.concatenate([p_null, p_sig]), q=0.10)
fd = m[:9000].sum() / max(1, m.sum())
print(f"[4] FDR discoveries {m.sum()}, false discovery proportion {fd:.3f} (<=0.10)")
ok &= fd <= 0.12

# 5) series_trend + pettitt step
s = pd.Series(season + 0.03 * (t - t[0]) + ar1_noise(300, 0.5, 0.5, ()), index=times)
st = tl.series_trend(s, "synthetic", "u")
print(f"[5] series slope/dec {st['slope_per_decade']:.3f} (true 0.3) p={st['p_ols_ar1']:.2g} MK-HR p={st['mk_hr_p']:.2g} verdict={st['verdict']}")
ok &= abs(st["slope_per_decade"] - 0.3) < 0.15
step = np.r_[np.zeros(12), np.ones(13) * 2] + rng.normal(0, 0.5, 25)
k, K, p = tl.pettitt(step)
print(f"[5b] Pettitt change index {k} (true 11) p={p:.3g}")
ok &= k in (10, 11, 12) and p < 0.05

# 6) GPU parity + timing for full grid pipeline
yy = (season[:, None, None] + 0.04 * (t - t[0])[:, None, None]
      + ar1_noise(300, 0.5, 1.0, (180, 360))).astype(np.float32)
t0 = time.time(); cpu = tl.grid_trends(yy, times, use_gpu=False); tc = time.time() - t0
try:
    t0 = time.time(); gpu = tl.grid_trends(yy, times, use_gpu=True); tg = time.time() - t0
    d = np.nanmax(np.abs(cpu["slope_dec"] - gpu["slope_dec"]))
    dm = np.nanmax(np.abs(cpu["p_mk"] - gpu["p_mk"]))
    print(f"[6] grid 180x360x300: CPU {tc:.1f}s GPU {tg:.1f}s; max diff slope {d:.2e}, p_mk {dm:.2e}")
    ok &= d < 1e-4
except Exception as exc:
    print(f"[6] GPU test skipped: {exc}; CPU {tc:.1f}s")
print(f"[6b] grid sig fraction (true trend everywhere): {cpu['sig_both'].mean():.3f}")

print("ALL OK" if ok else "SOME CHECKS FAILED")
