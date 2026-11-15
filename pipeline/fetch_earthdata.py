#!/usr/bin/env python3
"""Download NASA Earthdata products into data/share/<folder>/ (same layout as the team share).

Auth: Earthdata Login *bearer token* (never username/password). The token is read from
$EDL_TOKEN or from the file named by $EDL_TOKEN_FILE (default: <repo>/.edl.token).

Modes per product:
  full     download each granule as-is over HTTPS
  opendap  variable subset through cloud OPeNDAP (Hyrax, compressed netCDF-4 response)
  modis    download HDF4, keep only the listed SDS as compressed netCDF-4, delete the HDF

Re-runnable: finished files are skipped; partial files end in .part.

  python3 -I pipeline/fetch_earthdata.py --list
  python3 -I pipeline/fetch_earthdata.py m2aer imerg --workers 6
"""
import argparse, concurrent.futures as cf, datetime as dt, json, os, sys, threading, time
import urllib.error, urllib.parse, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = os.path.join(REPO, "data", "share")
CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
OPENDAP = "https://opendap.earthdata.nasa.gov/collections/{cid}/granules/{ur}.dap.nc4?dap4.ce={ce}"

# Variable lists are trimmed to what the series-2 layers / SPEC catalogue use: a full MERRA-2
# granule is 35-120 MB and the whole 1980- archive of five collections would be ~190 GB.
M2_LND = ["PRECTOTLAND", "EVLAND", "GWETROOT", "GWETTOP", "GWETPROF", "RUNOFF", "BASEFLOW",
          "SWLAND", "LWLAND", "TSURF", "SNOMAS", "TWLAND"]
PRODUCTS = {
    # key: folder, CMR short_name, version, mode, variables, notes
    "gldas":    dict(folder="gesdisc/gldas", sn="GLDAS_NOAH025_M", ver="2.1", mode="full"),
    "gldas1":   dict(folder="gesdisc/gldas_1deg", sn="GLDAS_NOAH10_M", ver="2.1", mode="full"),
    "imerg":    dict(folder="gesdisc/imerg", sn="GPM_3IMERGM", ver="07", mode="opendap",
                     vars=["/Grid/precipitation"],
                     coords=["/Grid/lat", "/Grid/lon", "/Grid/time"]),
    "m2aer":    dict(folder="gesdisc/m2aer", sn="M2TMNXAER", ver="5.12.4", mode="opendap",
                     vars=["TOTEXTTAU", "TOTANGSTR", "DUEXTTAU", "BCEXTTAU", "OCEXTTAU"]),
    "m2flx":    dict(folder="gesdisc/m2flx", sn="M2TMNXFLX", ver="5.12.4", mode="opendap",
                     vars=["PRECTOTCORR", "PRECTOT", "EVAP"]),
    "m2int":    dict(folder="gesdisc/m2int", sn="M2TMNXINT", ver="5.12.4", mode="opendap",
                     vars=["UFLXQV", "VFLXQV"]),
    "m2lnd":    dict(folder="gesdisc/m2lnd", sn="M2TMNXLND", ver="5.12.4", mode="opendap", vars=M2_LND),
    "m2slv":    dict(folder="gesdisc/m2slv", sn="M2TMNXSLV", ver="5.12.4", mode="opendap",
                     vars=["TO3", "TQV", "T2M"]),
    "ndvi":     dict(folder="modis/ndvi", sn="MOD13C2", ver="061", mode="modis",
                     vars=["CMG 0.05 Deg Monthly NDVI"]),
    "lst":      dict(folder="modis/lst", sn="MOD11C3", ver="061", mode="modis",
                     vars=["LST_Day_CMG", "LST_Night_CMG"]),
    "ceres":    dict(folder="ceres", sn="CERES_EBAF", ver="Edition4.2.1", mode="full"),
    "chl":      dict(folder="obdaac/chl", sn="MODISA_L3m_CHL", ver="2022.0", mode="full",
                     pattern="*.L3m.MO.CHL.chlor_a.9km.nc"),
}

_hdf_lock = threading.Lock()


def token():
    t = os.environ.get("EDL_TOKEN")
    if not t:
        with open(os.environ.get("EDL_TOKEN_FILE", os.path.join(REPO, ".edl.token"))) as f:
            t = f.read().strip()
    return t


def nasa_https(url):
    parsed = urllib.parse.urlsplit(url)
    host = parsed.hostname or ""
    return parsed.scheme == "https" and (host == "nasa.gov" or host.endswith(".nasa.gov"))


class KeepAuth(urllib.request.HTTPRedirectHandler):
    """Only forward Earthdata credentials to NASA HTTPS endpoints."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise urllib.error.URLError("Refusing a non-HTTPS data redirect")
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.remove_header("Authorization")
            auth = req.get_header("Authorization")
            if auth and nasa_https(newurl):
                new.add_unredirected_header("Authorization", auth)
        return new


OPENER = urllib.request.build_opener(KeepAuth)


def cmr_granules(p):
    q = {"short_name": p["sn"], "version": p["ver"], "page_size": 2000, "sort_key": "start_date"}
    if p.get("pattern"):
        q["readable_granule_name"] = p["pattern"]; q["options[readable_granule_name][pattern]"] = "true"
    out, after = [], None
    while True:
        req = urllib.request.Request(CMR + "?" + urllib.parse.urlencode(q))
        if after:
            req.add_header("CMR-Search-After", after)
        with urllib.request.urlopen(req, timeout=120) as r:
            after = r.headers.get("CMR-Search-After"); items = json.load(r)["items"]
        for it in items:
            u = it["umm"]
            urls = [x["URL"] for x in u.get("RelatedUrls", []) if x.get("Type") == "GET DATA"
                    and x["URL"].startswith("https") and not x["URL"].endswith((".xml", ".md5", ".txt"))]
            out.append(dict(cid=it["meta"]["collection-concept-id"], ur=u["GranuleUR"], urls=urls,
                            start=u["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]))
        if not items or not after:
            return out


def fetch(url, dest, tries=6):
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("Data downloads require HTTPS")
    tmp = dest + ".part"
    for k in range(tries):
        try:
            headers = {"User-Agent": "aqua-trend-pipeline/1.0"}
            if nasa_https(url):
                headers["Authorization"] = "Bearer " + token()
            req = urllib.request.Request(url, headers=headers)
            with OPENER.open(req, timeout=600) as r, open(tmp, "wb") as f:
                ctype = r.headers.get("Content-Type", "")
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            with open(tmp, "rb") as f:
                head = f.read(8)
            if b"<html" in head.lower() or b"<!doc" in head.lower() or "text/html" in ctype:
                raise RuntimeError("got HTML instead of data (auth/EULA?)")
            os.replace(tmp, dest)
            return os.path.getsize(dest)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise RuntimeError(f"HTTP {e.code} for {url} - token expired or EULA not accepted")
            if e.code == 404:
                raise
            err = e
        except Exception as e:  # network hiccup, Hyrax 5xx, truncated body
            err = e
        time.sleep(min(60, 3 * 2 ** k))
    if os.path.exists(tmp):
        os.remove(tmp)
    raise RuntimeError(f"failed after {tries} tries: {url}: {err}")


MODIS_BLOCK = 5   # 0.05 deg CMG -> 0.25 deg block mean; full-res CMG would be ~16 GB for NDVI+LST


def modis_extract(hdf, nc, sds_names):
    """Keep listed SDS as physical values averaged over 5x5 blocks (0.25 deg) + valid fraction.

    Fill and out-of-valid-range pixels are excluded before averaging. MODIS uses two scale
    conventions: NDVI stores value*10000 (scale_factor=10000 -> divide), LST stores value/0.02
    (scale_factor=0.02 -> multiply)."""
    from pyhdf.SD import SD, SDC
    import netCDF4, numpy as np
    src = SD(hdf, SDC.READ)
    ny, nx = src.select(sds_names[0]).info()[2]; b = MODIS_BLOCK
    res = 180.0 / ny * b; my, mx = ny // b, nx // b
    with netCDF4.Dataset(nc + ".part", "w", format="NETCDF4") as d:
        d.createDimension("lat", my); d.createDimension("lon", mx)
        la = d.createVariable("lat", "f4", ("lat",)); la[:] = 90 - res / 2 - res * np.arange(my)
        lo = d.createVariable("lon", "f4", ("lon",)); lo[:] = -180 + res / 2 + res * np.arange(mx)
        la.units = "degrees_north"; lo.units = "degrees_east"
        d.source_file = os.path.basename(hdf)
        d.processing = f"{b}x{b} block mean of valid {180.0 / ny:g} deg pixels (fill / out-of-range excluded)"
        for name in sds_names:
            s = src.select(name); raw = s.get(); at = s.attributes()
            ok = np.ones(raw.shape, bool)
            if isinstance(at.get("_FillValue"), (int, float)):
                ok &= raw != at["_FillValue"]
            if isinstance(at.get("valid_range"), list):
                ok &= (raw >= at["valid_range"][0]) & (raw <= at["valid_range"][1])
            sf = float(at.get("scale_factor", 1.0)); off = float(at.get("add_offset", 0.0))
            val = (raw.astype("f8") - off) / sf if sf > 1 else raw.astype("f8") * sf + off
            val = np.where(ok, val, 0.0).reshape(my, b, mx, b); okb = ok.reshape(my, b, mx, b)
            cnt = okb.sum((1, 3)); tot = val.sum((1, 3))
            mean = np.where(cnt > 0, tot / np.maximum(cnt, 1), np.nan).astype("f4")
            key = name.replace("CMG 0.05 Deg Monthly ", "").replace(" ", "_")
            v = d.createVariable(key, "f4", ("lat", "lon"), zlib=True, complevel=6, shuffle=True,
                                 fill_value=np.float32(np.nan), significant_digits=5)
            v[:] = mean; v.long_name = at.get("long_name", name); v.units = at.get("units", "")
            v.source_sds = name
            f = d.createVariable(key + "_valid_frac", "u1", ("lat", "lon"), zlib=True, complevel=6)
            f[:] = np.round(cnt / (b * b) * 100).astype("u1"); f.units = "percent"
    src.end()
    os.replace(nc + ".part", nc)


def outname(p, g):
    base = g["ur"].split(":")[-1]
    if p["mode"] == "opendap":
        return os.path.splitext(base)[0] + ".subset.nc4"
    if p["mode"] == "modis":
        return base + ".nc4"
    return os.path.basename(urllib.parse.urlparse(g["urls"][0]).path) if g["urls"] else base


def one(p, g, folder):
    dest = os.path.join(folder, outname(p, g))
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return "skip", 0
    if p["mode"] == "full":
        return "ok", fetch(g["urls"][0], dest)
    if p["mode"] == "opendap":
        names = p["vars"] + p.get("coords", ["/lat", "/lon", "/time"])
        ce = ";".join(n if n.startswith("/") else "/" + n for n in names)
        url = OPENDAP.format(cid=g["cid"], ur=urllib.parse.quote(g["ur"], safe=""),
                             ce=urllib.parse.quote(ce, safe="/;"))
        return "ok", fetch(url, dest)
    if p["mode"] == "modis":
        hdf_url = next(u for u in g["urls"] if u.endswith(".hdf"))
        tmp_hdf = os.path.join(folder, ".tmp_" + os.path.basename(hdf_url))
        fetch(hdf_url, tmp_hdf)
        try:
            with _hdf_lock:  # pyhdf / netCDF-C are not thread-safe (segfaults when parallel)
                modis_extract(tmp_hdf, dest, p["vars"])
        finally:
            os.remove(tmp_hdf)
        return "ok", os.path.getsize(dest)
    raise ValueError(p["mode"])


def run(key, workers, since):
    p = PRODUCTS[key]; folder = os.path.join(OUT_ROOT, p["folder"]); os.makedirs(folder, exist_ok=True)
    gs = [g for g in cmr_granules(p) if g["start"][:7] >= since]
    print(f"[{key}] {p['sn']} {p['ver']}: {len(gs)} granules -> {folder}", flush=True)
    ok = skip = nbytes = 0; errors = []
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(one, p, g, folder): g for g in gs}
        for i, f in enumerate(cf.as_completed(futs), 1):
            try:
                st, n = f.result(); ok += st == "ok"; skip += st == "skip"; nbytes += n
            except Exception as e:
                errors.append(f"{futs[f]['ur']}: {e}")
                print(f"[{key}] ERROR {errors[-1]}", flush=True)
                if "token expired" in str(e):
                    ex.shutdown(cancel_futures=True); break
            if i % 25 == 0 or i == len(gs):
                print(f"[{key}] {i}/{len(gs)} new={ok} skip={skip} {nbytes / 2**20:.0f} MB", flush=True)
    manifest = dict(product=key, short_name=p["sn"], version=p["ver"], mode=p["mode"],
                    variables=p.get("vars", "all"), granules=len(gs), downloaded=ok, skipped=skip,
                    errors=errors[:50], n_errors=len(errors), source="NASA Earthdata (CMR + "
                    + ("cloud OPeNDAP" if p["mode"] == "opendap" else "DAAC HTTPS") + ")",
                    first=gs[0]["start"][:7] if gs else None, last=gs[-1]["start"][:7] if gs else None,
                    fetched=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
    with open(os.path.join(folder, "_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    return len(errors)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("products", nargs="*")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--since", default="0000-00", help="YYYY-MM; skip granules before this month")
    a = ap.parse_args()
    if a.list or not a.products:
        for k, p in PRODUCTS.items():
            print(f"{k:8s} {p['folder']:22s} {p['sn']} {p['ver']} [{p['mode']}]")
        sys.exit(0)
    bad = sum(run(k, a.workers, a.since) for k in a.products)
    sys.exit(1 if bad else 0)
