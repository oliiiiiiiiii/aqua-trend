"""把瀏覽器編碼的 POWER 區域平均（int16 little-endian base64 + 檢查碼）解回 JSON"""
import base64, json, sys, numpy as np
SC = {"PRECTOTCORR": 100, "T2M": 100, "GWETROOT": 10000, "GWETTOP": 10000, "EVLAND": 100, "ALLSKY_SFC_SW_DWN": 100, "QV2M": 100, "WS2M": 100}
rid, npts, src = sys.argv[1], int(sys.argv[2]), sys.argv[3]
keys = [f"{y}{m:02d}" for y in range(2000, 2026) for m in range(1, 13)]
out = {"region": rid, "n_points": npts, "source": "NASA POWER monthly point API（community=AG），區域內 1° 陸地格點中心（大區域取 2° 間隔）以 cos(緯度) 加權平均",
       "downloaded": "2026-11-14", "series": {}}
bad = []
for line in open(src):
    p, b, cs = line.split()
    a = np.frombuffer(base64.b64decode(b), dtype="<i2").astype(np.int64)
    if a.size != len(keys) or int(a.sum()) != int(cs):
        bad.append((p, a.size, int(a.sum()), int(cs))); continue
    out["series"][p] = {k: (None if v == -32768 else round(v / SC[p], 4)) for k, v in zip(keys, a)}
json.dump(out, open(f"data/raw/power/{rid}.json", "w"))
print(rid, "ok:", list(out["series"]), "bad:", bad)
