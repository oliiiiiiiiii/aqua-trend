import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys, time
import numpy as np, pandas as pd
sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl
rng = np.random.default_rng(1)
times = pd.date_range("2002-01-01", periods=280, freq="MS")
def ar1(n, phi, size):
    e = rng.normal(size=(n,) + size); x = np.empty_like(e); x[0] = e[0]
    for i in range(1, n): x[i] = phi * x[i-1] + e[i]
    return x
seas = 2*np.sin(2*np.pi*times.month.values/12)[:, None]
x = seas + ar1(280, 0.7, (5000,)); y = seas + ar1(280, 0.7, (5000,))
r = tl.grid_corr(x, y, times)
print(f"[1] null: AR1-adjusted FPR {np.mean(r['p']<0.05):.3f}  naive FPR {np.mean(np.abs(r['r'])*np.sqrt(278/(1-r['r']**2))>1.97):.3f}")
ok = np.mean(r['p'] < 0.05) < 0.08
# known lag 2: y_t = x_{t-2} + noise
z = ar1(280, 0.3, (2000,)); yy = np.roll(z, 2, axis=0) + 0.8 * rng.normal(size=z.shape); yy[:2] = np.nan
bl = tl.best_lag(z, yy, times, lags=range(0, 5))
print(f"[2] recovered lag mode {np.bincount(bl['best_lag'].astype(int)).argmax()} (true 2), mean r {np.nanmean(bl['r']):.2f}")
ok &= np.bincount(bl['best_lag'].astype(int)).argmax() == 2
# series vs field broadcast & GPU parity
s = z[:, 0]
c1 = tl.grid_corr(z, s, times); c2 = tl.grid_corr(z, s, times, use_gpu=True)
print(f"[3] series-vs-field ok, self r={c1['r'][0]:.3f}; GPU max diff {np.nanmax(np.abs(c1['r']-c2['r'])):.1e}")
ok &= abs(c1['r'][0] - 1) < 1e-6 and np.nanmax(np.abs(c1['r']-c2['r'])) < 1e-8
print("ALL OK" if ok else "FAILED")
