#!/usr/bin/env python3
"""
切全球分析區域 → 網站用的 regions.json + GeoJSON + 0.5°/1° 遮罩

區域種類（每一處地表至少屬於一種）：
  basin3 / basin4  HydroBASINS 第 3 / 4 級流域（陸地，含格陵蘭）
  ice              南極冰蓋（IPCC AR6 東/西南極 ∩ 南極大陸）
  lme              66 個沿岸大海洋生態系（Marine Regions）
  sea              IPCC AR6 海洋分區扣掉 LME 之後的外海（12 個）
  named            具名區域（隊友 regions.py 的框 + 台灣本島）
  hex              H3 第 2 級六角格（約 8.7 萬 km²，全球備案）

需要：先跑 fetch_regions.sh；pip install geopandas regionmask h3 matplotlib
用法：python3 build_regions.py [stage]   stage = all(預設) | load | masks | attrs | write
中間結果快取在 data/interim/regions/，可分段跑。
"""
import glob, json, math, os, pickle, re, subprocess, sys, warnings
import numpy as np
import pandas as pd
import geopandas as gpd
import shapely
from shapely.geometry import box, Polygon, MultiPolygon

warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "data", "raw", "regions")
TMP = os.path.join(ROOT, "data", "interim", "regions")
OUT = os.path.join(ROOT, "web", "public", "data")
MASKDIR = os.path.join(ROOT, "data", "masks")
EA = "EPSG:6933"  # 等面積投影，用來算面積

LAT05 = -89.75 + 0.5 * np.arange(360); LON05 = -179.75 + 0.5 * np.arange(720)   # 隊友 hub 格網
LAT1 = -89.5 + 1.0 * np.arange(180);   LON1 = -179.5 + 1.0 * np.arange(360)

GRACE_MIN_KM2 = 200_000      # 小於這個面積，GRACE 結果會混到周圍
SNOW_MIN_FRAC = 0.05         # 至少 5% 降水是雪，才給「積雪」
ZH_OVERRIDE = {"TWN": "台灣"}

# 17 個類別 → 適用的地表
CATS = {
    "tws": ("陸地總儲水量", {"land", "ice"}), "groundwater": ("地下水", {"land"}),
    "soil": ("土壤水", {"land"}), "snow": ("積雪", {"land", "ice"}),
    "precip": ("降水", {"land", "ocean", "ice"}), "et": ("蒸發散", {"land"}),
    "runoff": ("逕流", {"land"}), "moisture": ("空中水氣", {"land", "ocean", "ice"}),
    "sea_level": ("海平面", {"ocean"}), "sea_ice": ("海冰", {"ocean"}),
    "tair": ("氣溫", {"land", "ice"}), "vpd": ("空氣乾燥度", {"land"}),
    "energy": ("日照與能量", {"land"}), "wind": ("風", {"land"}),
    "ndvi": ("植被", {"land"}), "sst": ("海溫", {"ocean"}),
    "climate_index": ("海洋氣候振盪", {"land", "ocean", "ice"}),
}


def P(*a):
    print(*a, flush=True)


def cache(name, obj=None):
    os.makedirs(TMP, exist_ok=True)
    f = os.path.join(TMP, name + ".pkl")
    if obj is None:
        return pickle.load(open(f, "rb"))
    pickle.dump(obj, open(f, "wb"))


def fix(g):
    g = shapely.make_valid(g)
    if g.geom_type == "GeometryCollection":
        g = shapely.union_all([x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
    return g


def wrap180(g):
    """把超出 ±180° 的部分切下來平移回來（跨換日線的流域 / 海域）。"""
    x0, _, x1, _ = g.bounds
    if x0 >= -180 and x1 <= 180:
        return g
    import shapely.affinity as aff
    parts = [g.intersection(box(-180, -90, 180, 90))]
    if x1 > 180:
        parts.append(aff.translate(g.intersection(box(180, -90, 540, 90)), -360))
    if x0 < -180:
        parts.append(aff.translate(g.intersection(box(-540, -90, -180, 90)), 360))
    return fix(shapely.union_all([p for p in parts if not p.is_empty]))


# ---------------- 1. 讀邊界 ----------------
def load():
    P("1/4 讀邊界資料")
    ne = os.path.join(RAW, "naturalearth")
    countries = gpd.read_file(f"{ne}/ne_50m_admin_0_countries.geojson")[["ADM0_A3", "NAME", "NAME_ZHT", "geometry"]]
    countries["zh"] = [ZH_OVERRIDE.get(a, z or n) for a, z, n in zip(countries.ADM0_A3, countries.NAME_ZHT, countries.NAME)]
    rivers = gpd.read_file(f"{ne}/ne_10m_rivers_lake_centerlines.geojson")[["name", "geometry"]].dropna(subset=["name"])

    layers = {}
    for lev in (3, 4):
        fs = sorted(glob.glob(f"{RAW}/hydrobasins/hybas_*_lev{lev:02d}_v1c.shp"))
        if len(fs) < 9:
            sys.exit(f"HydroBASINS 第 {lev} 級只找到 {len(fs)}/9 個檔，先跑 fetch_regions.sh")
        g = pd.concat([gpd.read_file(f).assign(cont=re.search(r"hybas_(\w\w)_", f).group(1)) for f in fs], ignore_index=True)
        g = gpd.GeoDataFrame(g, geometry="geometry", crs="EPSG:4326")
        g["id"] = [f"b{lev}-{h}" for h in g.HYBAS_ID]
        g["type"] = f"basin{lev}"
        g["surface"] = np.where(g.cont == "gr", "ice", "land")
        layers[f"basin{lev}"] = g[["id", "type", "surface", "HYBAS_ID", "PFAF_ID", "cont", "geometry"]]
        P(f"  流域第 {lev} 級：{len(g)} 個")

    # 南極：AR6 東/西南極 ∩ Natural Earth 南極大陸
    import regionmask
    ar6 = regionmask.defined_regions.ar6.land.to_geodataframe()
    ata = countries[countries.ADM0_A3 == "ATA"].geometry.union_all()
    ice = []
    for abbr, zh in (("EAN", "東南極冰蓋"), ("WAN", "西南極冰蓋")):
        geom = fix(ar6[ar6.abbrevs == abbr].geometry.iloc[0].intersection(ata))
        ice.append(dict(id=f"ice-{abbr}", type="ice", surface="ice", name=zh, geometry=geom))
    layers["ice"] = gpd.GeoDataFrame(ice, crs="EPSG:4326")

    # 海洋
    lme = gpd.read_file(f"{RAW}/marine/lme.geojson").to_crs("EPSG:4326")
    lme["geometry"] = [fix(shapely.simplify(g, 0.02)) for g in lme.geometry]
    lme = gpd.GeoDataFrame(dict(id=[f"lme-{int(n)}" for n in lme.lme_number], type="lme", surface="ocean",
                                name=lme.lme_name, geometry=lme.geometry), crs="EPSG:4326")
    # 外海：IPCC AR6 海洋分區（regionmask 內建）扣掉 LME 和陸地
    AR6_ZH = {"ARO": "北極海", "NPO": "北太平洋", "EPO": "赤道太平洋", "SPO": "南太平洋", "NAO": "北大西洋",
              "EAO": "赤道大西洋", "SAO": "南大西洋", "ARS": "阿拉伯海", "BOB": "孟加拉灣", "EIO": "赤道印度洋",
              "SIO": "南印度洋", "SOO": "南大洋", "CAR": "加勒比海", "MED": "地中海", "SEA": "東南亞海域"}
    ar6o = regionmask.defined_regions.ar6.ocean.to_geodataframe()
    land = fix(gpd.read_file(f"{RAW}/naturalearth/ne_50m_land.geojson").geometry.union_all())
    lme_all = fix(lme.geometry.union_all())
    seas = []
    for _, r in ar6o.iterrows():
        g = fix(fix(r.geometry).difference(lme_all).difference(land))
        if not g.is_empty:
            seas.append(dict(id=f"sea-{r.abbrevs}", type="sea", surface="ocean",
                             name=AR6_ZH.get(r.abbrevs, r.names), geometry=g))
    # 補缺口：AR6 陸地分區有延伸到近海，剩下的海面分給最近的大洋區
    ice_all = shapely.union_all([x["geometry"] for x in ice])
    rest = fix(box(-180, -90, 180, 90).difference(land).difference(lme_all).difference(ice_all))
    left = fix(rest.difference(shapely.union_all([x["geometry"] for x in seas])))
    for comp in getattr(left, "geoms", [left]):
        if comp.area < 0.01:
            continue
        pt = comp.representative_point()
        k = int(np.argmin([x["geometry"].distance(pt) for x in seas]))
        seas[k]["geometry"] = fix(shapely.union_all([seas[k]["geometry"], comp]))
    seas = gpd.GeoDataFrame(pd.DataFrame(seas, columns=["id", "type", "surface", "name", "geometry"]), geometry="geometry", crs="EPSG:4326")
    layers["lme"], layers["sea"] = lme, seas
    P(f"  LME {len(lme)} 個、外海 {len(seas)} 個、南極 {len(ice)} 個")

    # 具名區域：隊友的 REGIONS（從 git branch 讀）+ 台灣本島
    named = []
    try:
        src = subprocess.run(["git", "-C", ROOT, "show", "origin/analysis/water-trends:analysis/scripts/regions.py"],
                             capture_output=True, text=True, check=True).stdout
        ns = {}; exec(src, ns)
        for k, (x0, x1, y0, y1) in ns["REGIONS"].items():
            slug = re.sub(r"[^a-z0-9]+", "-", k.lower()).strip("-")
            named.append(dict(id=f"named-{slug}", type="named", name=k, geometry=box(x0, y0, x1, y1)))
    except Exception as e:  # noqa: BLE001
        P("  （讀不到隊友的 regions.py，略過：", e, "）")
    twn = countries[countries.ADM0_A3 == "TWN"].geometry.iloc[0]
    main = max(getattr(twn, "geoms", [twn]), key=lambda p: p.area)
    named.append(dict(id="named-taiwan-main-island", type="named", name="台灣本島", geometry=main))
    layers["named"] = gpd.GeoDataFrame(named, crs="EPSG:4326")
    P(f"  具名區域 {len(named)} 個")

    for k, g in layers.items():
        g["geometry"] = [wrap180(fix(x)) for x in g.geometry]
    cache("load", dict(layers=layers, countries=countries, rivers=rivers))


# ---------------- 2. 遮罩 ----------------
def masks():
    P("2/4 做 0.5° / 1° 遮罩")
    import regionmask, h3
    d = cache("load"); layers = d["layers"]
    out = {}
    for res, lat, lon in (("0p5", LAT05, LON05), ("1deg", LAT1, LON1)):
        for name, g in layers.items():
            if len(g) == 0:
                out[(res, name)] = np.full((lat.size, lon.size), -1, np.int32); continue
            gg = g[["geometry"]].copy(); gg["num"] = np.arange(len(g))
            rm = regionmask.from_geopandas(gg, numbers="num", overlap=(name == "named"))
            m = rm.mask_3D(lon, lat) if name == "named" else rm.mask(lon, lat)
            if name == "named":   # 具名區域可以重疊 → 存成 (region, lat, lon) bool
                full = np.zeros((len(g), lat.size, lon.size), bool)
                full[m.region.values] = m.values
                out[(res, name)] = full
            else:
                a = m.values; out[(res, name)] = np.where(np.isfinite(a), a, -1).astype(np.int32)
            P(f"  {res} {name}")
        # 六角格：直接用格點中心算屬於哪一格
        LA, LO = np.meshgrid(lat, lon, indexing="ij")
        cells = np.array([h3.latlng_to_cell(float(a), float(b), 2) for a, b in zip(LA.ravel(), LO.ravel())]).reshape(LA.shape)
        out[(res, "hex_raw")] = cells
        P(f"  {res} hex")
    cache("masks", out)


# ---------------- 3. 屬性 ----------------
def attrs():
    P("3/4 算屬性：面積、國家、名稱、地表、可選類別")
    import h3
    d = cache("load"); M = cache("masks")
    layers, countries, rivers = d["layers"], d["countries"], d["rivers"]

    # 0.5° 地表遮罩
    land05 = (M[("0p5", "basin3")] >= 0)
    ice05 = (M[("0p5", "ice")] >= 0) | np.isin(M[("0p5", "basin3")], np.nonzero(layers["basin3"].surface.values == "ice")[0])
    ocean05 = ~(land05 | ice05)
    w05 = np.cos(np.deg2rad(LAT05))[:, None] * np.ones((1, LON05.size))

    # 積雪比例（GLDAS 1°）：每個 1° 格點的 降雪 / 總降水
    snow1 = np.full((LAT1.size, LON1.size), np.nan)
    fs = sorted(glob.glob(os.path.join(ROOT, "data", "gldas_1deg", "*.nc4")))
    if fs:
        import netCDF4
        sn = rn = 0
        for f in fs:
            with netCDF4.Dataset(f) as ds:
                sn = sn + np.ma.filled(ds["Snowf_tavg"][0], np.nan); rn = rn + np.ma.filled(ds["Rainf_f_tavg"][0], np.nan)
        frac = sn / np.where(rn > 0, rn, np.nan)            # GLDAS 緯度 -59.5..89.5
        snow1[30:180] = frac
        P(f"  積雪比例：用 {len(fs)} 個 GLDAS 月檔")
    else:
        P("  （找不到 data/gldas_1deg，積雪一律依地表給）")

    cea = countries.to_crs(EA)
    recs = []
    hexcells = M[("0p5", "hex_raw")]

    def surface_frac(sel):
        w = w05[sel].sum()
        if w == 0:
            return None
        return dict(land=float(w05[sel & land05].sum() / w), ocean=float(w05[sel & ocean05].sum() / w), ice=float(w05[sel & ice05].sum() / w))

    def available(surf_type, fr, snow, lat_c, area):
        s = set()
        if fr is None:
            fr = {surf_type: 1.0}
        if fr.get("land", 0) >= 0.3: s.add("land")
        if fr.get("ocean", 0) >= 0.3: s.add("ocean")
        if fr.get("ice", 0) >= 0.3: s.add("ice")
        if not s: s.add(surf_type)
        av, warn = [], {}
        for k, (_zh, ok) in CATS.items():
            if not (ok & s):
                continue
            if k == "snow" and "ice" not in s and not (snow is not None and snow >= SNOW_MIN_FRAC):
                continue
            if k == "sea_ice" and not (lat_c >= 65 or lat_c <= -55):   # 只有北極海、南大洋有海冰資料
                continue
            av.append(k)
            if k in ("tws", "groundwater") and area < GRACE_MIN_KM2:
                warn[k] = f"區域約 {area:,.0f} km²，小於 GRACE 可分辨的約 {GRACE_MIN_KM2:,} km²，結果會混到周圍"
        if len(s) > 1:
            warn["_mixed"] = "這個區域同時有陸地和海洋，部分類別只用到其中一部分"
        return av, warn

    def countries_of(geom_ea, total):
        hit = cea[cea.intersects(geom_ea)]
        out = []
        for _, c in hit.iterrows():
            a = c.geometry.intersection(geom_ea).area
            if a / total >= 0.05 or a > 20_000e6:
                out.append((a, c.zh, c.ADM0_A3))
        return [dict(zh=z, iso=i) for _, z, i in sorted(out, reverse=True)[:4]]

    # 河流名稱 → 流域名稱（取流域內總長最長的河）
    def river_names(g):
        j = gpd.sjoin(rivers, g[["id", "geometry"]], predicate="intersects")
        best = {}
        for idx, grp in j.groupby("id"):
            geom = g.set_index("id").geometry[idx]
            L = {}
            for _, r in grp.iterrows():
                L[r["name"]] = L.get(r["name"], 0) + r.geometry.intersection(geom).length
            best[idx] = max(L, key=L.get)
        return best

    for name, g in layers.items():
        gea = g.to_crs(EA)
        rn_ = river_names(g) if name.startswith("basin") else {}
        mk05 = M[("0p5", name)]; mk1 = M[("1deg", name)]
        for k, (_, r) in enumerate(g.iterrows()):
            geom_ea = gea.geometry.iloc[k]; area = geom_ea.area / 1e6
            if name == "named":
                sel = mk05[k]; sel1 = mk1[k]
            else:
                sel = mk05 == k; sel1 = mk1 == k
            n05 = int(sel.sum())
            c = r.geometry.representative_point()
            fr = surface_frac(sel) if n05 else None
            sv = snow1[sel1] if sel1.any() else snow1[[int(np.clip(np.floor(c.y + 90), 0, 179))], [int(np.clip(np.floor(c.x + 180), 0, 359))]]
            snow = float(np.nanmean(sv)) if np.isfinite(sv).any() else None
            surf0 = r["surface"] if "surface" in g.columns else None
            ctry = [] if surf0 == "ocean" else countries_of(geom_ea, geom_ea.area)
            if name.startswith("basin"):
                river = rn_.get(r.id)
                where = "、".join(x["zh"] for x in ctry[:3]) or "島嶼"
                nm = f"{river} 流域（{where}）" if river else f"{where} 流域 {str(r.PFAF_ID)}"
            else:
                nm = r["name"]
            surf = surf0 or (max(fr, key=fr.get) if fr else "land")
            av, warn = available(surf, fr, snow, c.y, area)
            if n05 == 0:
                warn["_small"] = "比 0.5° 格點還小，分析時會用包含它的上一級區域"
            b = r.geometry.bounds
            recs.append(dict(id=r.id, type=r.type, name=nm, surface=surf, area_km2=round(area),
                             centroid=[round(c.x, 3), round(c.y, 3)], bbox=[round(x, 2) for x in b],
                             countries=ctry, n_cells_0p5=n05, snow_frac=None if snow is None else round(snow, 3),
                             surface_frac=None if fr is None else {k2: round(v, 3) for k2, v in fr.items()},
                             available=av, warnings=warn,
                             pfaf=int(r.PFAF_ID) if name.startswith("basin") else None))
        P(f"  {name}: {len(g)}")

    # 流域第 4 級 → 第 3 級（Pfafstetter 碼前 3 碼）
    p3 = {r["pfaf"]: r["id"] for r in recs if r["type"] == "basin3"}
    for r in recs:
        if r["type"] == "basin4":
            r["parent"] = p3.get(r["pfaf"] // 10)

    # 六角格
    hexes = np.unique(hexcells)
    b3 = M[("0p5", "basin3")]; lmem = M[("0p5", "lme")]; seam = M[("0p5", "sea")]
    nm_b3 = {i: r for i, r in enumerate([x for x in recs if x["type"] == "basin3"])}
    nm_lme = [x for x in recs if x["type"] == "lme"]; nm_sea = [x for x in recs if x["type"] == "sea"]
    for hcell in hexes:
        sel = hexcells == hcell
        fr = surface_frac(sel)
        lat_c, lon_c = h3.cell_to_latlng(hcell)
        area = h3.cell_area(hcell, unit="km^2")
        surf = max(fr, key=fr.get)
        # 名稱：最多格點落在哪個國家 / 海域
        if surf == "ocean":
            v = np.concatenate([lmem[sel][lmem[sel] >= 0]]); src = nm_lme
            if v.size == 0: v = seam[sel][seam[sel] >= 0]; src = nm_sea
            where = src[int(np.bincount(v).argmax())]["name"] if v.size else "海洋"
        else:
            v = b3[sel][b3[sel] >= 0]
            cs = nm_b3[int(np.bincount(v).argmax())]["countries"] if v.size else []
            where = cs[0]["zh"] if cs else ("南極" if lat_c < -60 else "陸地")
        snow = float(np.nanmean(snow1[int(np.clip(np.floor(lat_c + 90), 0, 179)), int(np.clip(np.floor(lon_c + 180), 0, 359))]))
        av, warn = available(surf, fr, None if math.isnan(snow) else snow, lat_c, area)
        recs.append(dict(id=f"hex-{hcell}", type="hex", name=f"{where} 六角格 {hcell.rstrip('f')[-4:]}", surface=surf,
                         area_km2=round(area), centroid=[round(lon_c, 3), round(lat_c, 3)], bbox=None, countries=[],
                         n_cells_0p5=int(sel.sum()), snow_frac=None if math.isnan(snow) else round(snow, 3),
                         surface_frac={k: round(v2, 3) for k, v2 in fr.items()}, available=av, warnings=warn, pfaf=None))
    P(f"  hex: {len(hexes)}")
    cache("attrs", recs)


# ---------------- 4. 寫檔 ----------------
def hex_polygon(cell):
    import h3
    pts = [(lng, lat) for lat, lng in h3.cell_to_boundary(cell)]
    xs = [p[0] for p in pts]
    if max(xs) - min(xs) > 180:   # 跨換日線：切兩半
        pts = [(x + 360 if x < 0 else x, y) for x, y in pts]
        p = Polygon(pts)
        a = p.intersection(box(-180, -90, 180, 90)); b = shapely.affinity.translate(p.intersection(box(180, -90, 540, 90)), -360)
        return fix(shapely.union_all([a, b]))
    return Polygon(pts)


def write():
    P("4/4 寫檔")
    import shapely.affinity  # noqa: F401
    d = cache("load"); M = cache("masks"); recs = cache("attrs")
    layers = d["layers"]
    os.makedirs(f"{OUT}/catalog", exist_ok=True); os.makedirs(f"{OUT}/geo", exist_ok=True); os.makedirs(MASKDIR, exist_ok=True)

    clean = [{k: v for k, v in r.items() if v is not None and v != {} and v != []} for r in recs]
    json.dump(dict(generated="build_regions.py", grace_min_km2=GRACE_MIN_KM2, snow_min_frac=SNOW_MIN_FRAC,
                   categories={k: dict(name=v[0], surfaces=sorted(v[1])) for k, v in CATS.items()},
                   regions=clean), open(f"{OUT}/catalog/regions.json", "w"), ensure_ascii=False, separators=(",", ":"))

    # 國家 → 區域（搜尋入口）
    idx = {}
    for r in recs:
        for c in r.get("countries") or []:
            idx.setdefault(c["iso"], dict(zh=c["zh"], regions=[]))["regions"].append(r["id"])
    json.dump(idx, open(f"{OUT}/catalog/countries.json", "w"), ensure_ascii=False, separators=(",", ":"))

    tol = dict(basin3=0.03, basin4=0.02, ice=0.05, lme=0.05, sea=0.05, named=0.01)
    byid = {r["id"]: r for r in recs}
    for name, g in layers.items():
        gg = g[["id", "geometry"]].copy()
        gg["geometry"] = [shapely.set_precision(fix(shapely.simplify(x, tol[name])), 0.001) for x in gg.geometry]
        gg["name"] = [byid[i]["name"] for i in gg.id]
        open(f"{OUT}/geo/{name}.geojson", "w").write(gg.to_json(drop_id=True))
    hx = [r["id"] for r in recs if r["type"] == "hex"]
    hxg = gpd.GeoDataFrame(dict(id=hx, name=[byid[i]["name"] for i in hx]),
                     geometry=[shapely.set_precision(hex_polygon(i[4:]), 0.001) for i in hx], crs="EPSG:4326")
    open(f"{OUT}/geo/hex.geojson", "w").write(hxg.to_json(drop_id=True))

    # 遮罩：給 export_web.py 算區域平均
    for res, lat, lon in (("0p5", LAT05, LON05), ("1deg", LAT1, LON1)):
        arrs = {}
        for name, g in layers.items():
            a = M[(res, name)]
            if name == "named":
                arrs["named"] = a; arrs["named_ids"] = np.array(g.id.values, dtype="U80")
            else:
                arrs[name] = a; arrs[f"{name}_ids"] = np.array(g.id.values, dtype="U80")
        hx_raw = M[(res, "hex_raw")]; u, inv = np.unique(hx_raw, return_inverse=True)
        arrs["hex"] = inv.reshape(hx_raw.shape).astype(np.int32); arrs["hex_ids"] = np.array([f"hex-{x}" for x in u], dtype="U80")
        np.savez_compressed(f"{MASKDIR}/regions_{res}.npz", lat=lat, lon=lon, **arrs)

    # 預覽圖
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        fig, axs = plt.subplots(3, 1, figsize=(14, 19))
        rng = np.random.default_rng(1)
        panels = (("A. Basins L3 + Antarctic ice + coastal LME + open seas", ["basin3", "ice", "lme", "sea"]),
                  ("B. Basins L4 + Antarctic ice + coastal LME + open seas", ["basin4", "ice", "lme", "sea"]),
                  ("C. H3 hexagons (fallback grid, ~87,000 km2 each)", ["hex"]))
        for ax, (title, keys) in zip(axs, panels):
            img = np.full((LAT05.size, LON05.size), np.nan)
            for k in keys:
                if k == "hex":
                    _, a = np.unique(M[("0p5", "hex_raw")], return_inverse=True); a = a.reshape(LAT05.size, LON05.size)
                else:
                    a = M[("0p5", k)]
                if a.max() < 0:
                    continue
                col = rng.integers(0, 20, a.max() + 1)
                img = np.where(np.isnan(img) & (a >= 0), col[np.clip(a, 0, None)], img)
            ax.pcolormesh(LON05, LAT05, img, cmap="tab20", vmin=0, vmax=19, shading="auto")
            ax.set_title(title); ax.set_aspect("equal")
        fig.tight_layout(); fig.savefig(f"{OUT}/geo/preview_regions.png", dpi=90)
    except Exception as e:  # noqa: BLE001
        P("  預覽圖失敗：", e)

    from collections import Counter
    P("  區域數：", dict(Counter(r["type"] for r in recs)))
    for f in sorted(glob.glob(f"{OUT}/geo/*")) + sorted(glob.glob(f"{OUT}/catalog/*")) + sorted(glob.glob(f"{MASKDIR}/*")):
        P(f"  {os.path.relpath(f, ROOT):<45} {os.path.getsize(f) / 1e6:6.1f} MB")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "all"
    for s, fn in (("load", load), ("masks", masks), ("attrs", attrs), ("write", write)):
        if stage in ("all", s):
            fn()
