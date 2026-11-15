#!/usr/bin/env python3
"""
全世界版：下載 GLDAS Noah 2.1 **1° 全球月資料**（2000-01 起到最新）
每個檔約 2 MB，全部約 320 個檔、~650 MB。只用 Python 內建套件。

用法（在 aqua-trend 資料夾）：
    python3 download_global.py            # 全部下載（可中斷，重跑會續傳）
    python3 download_global.py 2000 2024  # 只下載指定年份範圍

需要 ~/.netrc 裡的 Earthdata 帳密（跟 download.py 一樣）。
檔案存到 data/gldas_1deg/
每個檔包含全球 360x150 格、約 36 個變數：土壤濕度（4 層）、根層水、
蒸發散、地表/地下逕流、降雨、降雪、積雪水當量、氣溫、濕度…
"""
import datetime as dt
import http.cookiejar
import netrc
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = ("https://data.gesdisc.earthdata.nasa.gov/data/GLDAS/GLDAS_NOAH10_M.2.1/"
        "{y}/GLDAS_NOAH10_M.A{y}{m:02d}.021.nc4")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "gldas_1deg")


def opener():
    hs = [urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())]
    auth = netrc.netrc().authenticators("urs.earthdata.nasa.gov")
    if not auth:
        sys.exit("~/.netrc 裡找不到 urs.earthdata.nasa.gov 的帳密")
    pm = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    pm.add_password(None, "https://urs.earthdata.nasa.gov", auth[0], auth[2])
    hs.append(urllib.request.HTTPBasicAuthHandler(pm))
    return urllib.request.build_opener(*hs)


OP = opener()


def ok(path):
    try:
        with open(path, "rb") as f:
            return f.read(4) == b"\x89HDF" and os.path.getsize(path) > 500_000
    except OSError:
        return False


def get(y, m):
    path = os.path.join(OUT, f"GLDAS_NOAH10_M.A{y}{m:02d}.021.nc4")
    if ok(path):
        return "skip", path
    url = BASE.format(y=y, m=m)
    for i in range(3):
        try:
            with OP.open(urllib.request.Request(url, headers={"User-Agent": "aqua-trend/1.0"}), timeout=180) as r:
                data = r.read()
            if data[:4] != b"\x89HDF":
                if r.geturl() and "urs.earthdata" in r.geturl() or data[:1] == b"<":
                    raise RuntimeError("拿到網頁不是資料（登入或授權問題）")
                raise RuntimeError("檔案格式不對")
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            return "ok", path
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "missing", url  # 這個月還沒出
            last = e
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(3 * (i + 1))
    return f"fail: {last}", url


def main():
    y0 = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    y1 = int(sys.argv[2]) if len(sys.argv) > 2 else dt.date.today().year
    os.makedirs(OUT, exist_ok=True)
    months = [(y, m) for y in range(y0, y1 + 1) for m in range(1, 13)
              if dt.date(y, m, 1) < dt.date.today().replace(day=1)]
    print(f"下載 {len(months)} 個月 → {OUT}")

    # 先試一個，失敗就停
    st, info = get(*months[0])
    if st.startswith("fail"):
        sys.exit(f"✗ 第一個檔就失敗：{st}\n  {info}")
    counts = {"ok": 0, "skip": 0, "missing": 0, "fail": 0}
    counts[st.split(":")[0]] += 1
    fails = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(get, y, m): (y, m) for (y, m) in months[1:]}
        for n, f in enumerate(as_completed(futs), 2):
            st, info = f.result()
            counts[st.split(":")[0]] += 1
            if st.startswith("fail"):
                fails.append((futs[f], st))
            if n % 24 == 0:
                print(f"  {n}/{len(months)}  {counts}")
    print(f"\n完成：{counts}")
    if counts["missing"]:
        print("  missing = NASA 還沒發布的最新月份，正常")
    for ym, st in fails:
        print(f"  ✗ {ym}: {st}")
    if fails:
        print("  失敗的重跑一次就會補抓")


if __name__ == "__main__":
    main()
