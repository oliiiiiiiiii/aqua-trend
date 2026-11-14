"""Download MODIS/Terra monthly snow cover CMG (MOD10CM v61, 0.05 deg, NSIDC) 2000-2026 into data/raw/mod10cm/."""
import os
import sys
import earthaccess
ROOT = os.environ.get("AQUA_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
dst = f"{ROOT}/data/raw/mod10cm"
os.makedirs(dst, exist_ok=True)
earthaccess.login(strategy="netrc")
r = earthaccess.search_data(short_name="MOD10CM", temporal=("2000-01-01", "2026-12-31"), count=400)
have = set(os.listdir(dst))
todo = [g for g in r if os.path.basename(g.data_links()[0]) not in have]
print(len(r), "granules,", len(todo), "to fetch", flush=True)
if todo:
    earthaccess.download(todo, dst, threads=4)
for f in os.listdir(dst):
    os.chmod(f"{dst}/{f}", 0o777)
print("done", len(os.listdir(dst)))
