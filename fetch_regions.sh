#!/bin/bash
# 下載切區域用的邊界資料 → data/raw/regions/（約 40 MB）
# 用法：在 aqua-trend 資料夾執行  bash fetch_regions.sh
set -e
D="$(cd "$(dirname "$0")" && pwd)/data/raw/regions"
mkdir -p "$D/hydrobasins" "$D/marine"
cd "$D/hydrobasins"
for r in af ar as au eu gr na sa si; do
  for l in 03 04; do
    f="hybas_${r}_lev${l}_v1c.zip"
    if [ ! -s "$f" ]; then
      echo "下載 $f"; curl -fsSL -o "$f" "https://data.hydrosheds.org/file/hydrobasins/standard/$f"
    fi
    unzip -oq "$f"
  done
done
cd "$D/marine"
W="https://geo.vliz.be/geoserver/MarineRegions/wfs?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&typeName=MarineRegions:"
[ -s lme.geojson ] || { echo "下載 LME（66 個沿岸大海洋生態系）"; curl -fsSL -o lme.geojson "${W}lme"; }
# 外海用 regionmask 內建的 IPCC AR6 海洋分區，不用下載
echo; echo "完成："; du -sh "$D"/*
