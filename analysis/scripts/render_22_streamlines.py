"""Re-render task 22 moisture-transport maps as streamlines (width ~ flux strength) over P - E."""
import os as _os
ROOT = _os.environ.get("AQUA_ROOT", _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import sys
import textwrap
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature

sys.path.insert(0, ROOT + "/scripts")
import trendlib as tl  # noqa: E402
import viz  # noqa: E402
import hub  # noqa: E402

out = tl.task_dir("22_moisture_transport")
SRC = "Data: NASA MERRA-2 (M2TMNXINT vertically integrated water-vapour flux; M2TMNXFLX evaporation & precipitation), 1980–2026."
LATm = -90 + 0.5 * np.arange(361); LONm = -180 + 0.625 * np.arange(576)
t, U = hub._gd("m2int", "UFLXQV", "native"); _, V = hub._gd("m2int", "VFLXQV", "native")
_, E = hub._gd("m2flx", "EVAP", "native"); _, P = hub._gd("m2flx", "PRECTOTCORR", "native")
mon = t.month
SEAS = {"annual": np.ones(len(t), bool), "JJA": np.isin(mon, [6, 7, 8]), "DJF": np.isin(mon, [12, 1, 2])}
NAMES = {"annual": "all year", "JJA": "summer monsoon, Jun–Aug", "DJF": "winter monsoon, Dec–Feb"}
for sn, sel in SEAS.items():
    u = U[sel].mean(0); v = V[sel].mean(0); pe = (P[sel].mean(0) - E[sel].mean(0)) * 86400
    spd = np.hypot(u, v)
    for region, ext, fs, dens, vmax in (("global", None, (13, 7.0), 2.2, 6), ("eastasia", (95, 150, 5, 45), (11, 8.4), 1.6, 10)):
        fig = plt.figure(figsize=fs, dpi=170)
        if ext is None:
            ax = fig.add_axes([0.02, 0.15, 0.96, 0.70], projection=ccrs.Robinson(central_longitude=150)); ax.set_global()
        else:
            ax = fig.add_axes([0.04, 0.15, 0.92, 0.70], projection=ccrs.PlateCarree()); ax.set_extent(ext, crs=ccrs.PlateCarree())
        im = ax.pcolormesh(LONm, LATm, pe, transform=ccrs.PlateCarree(), cmap=viz.div_cmap("water"), vmin=-vmax, vmax=vmax,
                           shading="auto", rasterized=True)
        if ext is None:
            j = slice(None); i = slice(None)
        else:
            j = (LATm >= ext[2] - 5) & (LATm <= ext[3] + 5); i = (LONm >= ext[0] - 5) & (LONm <= ext[1] + 5)
        lw = 0.4 + 2.6 * np.clip(spd[j][:, i] / 500.0, 0, 1)
        ax.streamplot(LONm[i], LATm[j], u[j][:, i], v[j][:, i], transform=ccrs.PlateCarree(), density=dens, color=viz.INK,
                      linewidth=lw, arrowsize=0.8)
        ax.add_feature(cfeature.COASTLINE.with_scale("110m" if ext is None else "50m"), linewidth=0.6, edgecolor="#3a3936")
        ttl = ("Rivers in the sky: where the atmosphere picks up water and where it drops it" if ext is None
               else "Moisture highways into Taiwan & East Asia")
        fig.text(0.03, 0.965, f"{ttl} ({NAMES[sn]})", fontsize=14.5, fontweight="bold", va="top")
        sub = ("Lines: water vapour carried by the winds (thicker = more water). Orange: evaporation exceeds rain "
               "(moisture source). Blue: rain exceeds evaporation (moisture destination).")
        fig.text(0.03, 0.915, "\n".join(textwrap.wrap(sub, int(14 * fs[0]))), fontsize=9.5, color=viz.INK2, va="top")
        cax = fig.add_axes([0.30, 0.085, 0.40, 0.022])
        cb = fig.colorbar(im, cax=cax, orientation="horizontal", extend="both"); cb.outline.set_visible(False)
        cb.set_label("precipitation − evaporation (mm/day)", fontsize=9, color=viz.INK2); cb.ax.tick_params(labelsize=8, length=0)
        fig.text(0.03, 0.012, SRC, fontsize=7.5, color=viz.MUTED)
        fn = f"{out}/map_PminusE_flux_{sn}{'' if ext is None else '_eastasia'}.png"
        fig.savefig(fn); plt.close(fig)
        print("rendered", fn, flush=True)
tl.fix_perms(out)
