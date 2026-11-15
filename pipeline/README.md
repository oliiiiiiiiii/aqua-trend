# Rebuilding website data

Website deployment uses the checked and pinned GitHub Release bundle in `web/data.lock.json`; follow [`deploy/README.md`](../deploy/README.md). It does not run this pipeline or require NASA credentials. These scripts are for maintainers who deliberately regenerate scientific layers from upstream files.

## Python environment

The dependency pins were tested with CPython 3.13.5. From the repository root:

```sh
python3.13 -m venv pipeline/.venv
pipeline/.venv/bin/python -m pip install -r pipeline/requirements.txt
pipeline/.venv/bin/python -I pipeline/test_pipeline.py
```

The `.venv` directory is ignored by Git. The tests use temporary, synthetic inputs and make no network requests. `pyhdf` needs HDF4 libraries if no wheel is available on your platform; `netCDF4` similarly needs netCDF-C/HDF5 when built from source.

`data/masks/regions_0p5.npz` is a repository input. Scripts write intermediates under `data/interim/layers` and browser data under `web/public/data`; raw files remain under the ignored `data/share` directory. That directory name is a local cache convention. The scripts do not depend on a team member's HTTP share.

## Official inputs

For supported Earthdata products, inspect the downloader's product list first:

```sh
pipeline/.venv/bin/python -I pipeline/fetch_earthdata.py --list
```

The downloader discovers granules through NASA CMR and downloads through official DAAC HTTPS or cloud OPeNDAP endpoints. Set `EDL_TOKEN` or `EDL_TOKEN_FILE` in the maintainer's environment, or place the token in the ignored repository-root `.edl.token`. Approve the product's required Earthdata applications/EULAs. The monthly website needs no token; its optional on-demand daily API uses a separate runtime credential configuration described in `deploy/README.md`. Authorization is forwarded only to NASA HTTPS hosts, and HTTP redirects are refused.

The following is an optional, real download and processing workflow, not part of setup or tests:

```sh
pipeline/.venv/bin/python -I pipeline/fetch_earthdata.py m2aer m2slv --since 2025-01 --workers 2
pipeline/.venv/bin/python -I pipeline/earthdata_layers.py aod to3_m2 tqv
```

`earthdata_layers.py` also builds `lst_night` from the downloaded MODIS LST subset, `rn_ceres` from CERES EBAF `sfc_net_tot_all_mon`, and six MERRA-2 land products. CERES surface radiation combines satellite observations with radiative-transfer calculations; its 1° native grid limits small-region representativeness. GLDAS, IMERG, and daytime LST `*_check` layers are validation intermediates, not products to publish. File reading stays single-threaded because the netCDF-C/HDF4 libraries are not thread-safe.

`--since` limits the earliest granule; there is no end-date limit. Inspect storage requirements before downloading full history. Files already present and nonempty are reused. The `_manifest.json` records product/version, variables, dates, and failures; it does not record a checksum for every raw input. Preserve the exact original inputs and their SHA-256 sums when a release must be reproducible from raw data. Re-querying a live NASA collection can retrieve newer or reprocessed granules. For duplicate MERRA-2 months, `MERRA2_401` is preferred over `MERRA2_400`, consistent with NASA's [reprocessing record](https://docserver.gesdisc.eosdis.nasa.gov/public/project/MERRA/Records_MERRA-2_Data_Reprocessing_and_Service_Changes.pdf).

Three input types are supplied manually through their official providers:

| Layer | Official input | Local layout and command |
| --- | --- | --- |
| `fire_count` | [NASA FIRMS archive](https://firms.modaps.eosdis.nasa.gov/download/), MODIS Collection 6.1 country CSVs | Put each year's country CSVs in `data/share/firms/modis_YYYY_all_countries.zip`; run `python -I pipeline/share_firms.py` with the environment's Python |
| `snow_cover` | [MOD10CM Collection 6.1](https://nsidc.org/data/mod10cm/versions/61), monthly HDF files | Put original `MOD10CM.A*.hdf` files in `data/share/mod10cm`; run `python -I pipeline/share_mod10cm.py` |
| `so2_emis` | [NASA MSAQSO2L4 V2 catalogue](https://data.nasa.gov/dataset/multi-satellite-air-quality-sulfur-dioxide-so2-database-long-term-l4-global-v2-msaqso2l4-a-d5d7e), netCDF | Run `python -I pipeline/share_so2.py /absolute/path/to/MSAQSO2L4_....nc` |

FIRMS archives must include `latitude`, `longitude`, `acq_date`, `acq_time`, `satellite`, and `type` columns. Missing `type` cannot establish a vegetation fire and is rejected. The default uses Terra only, removes duplicate country records, and retains type 0. Empty archives and months with no records for the selected satellite stay unknown. Regional zeroes mean zero recorded vegetation-fire detections in a month with archive records; they do not prove absence of fire or complete observations. [NASA describes cloud, smoke, and observation-time limits on detections](https://firms.modaps.eosdis.nasa.gov/alerts/notes.php). Boundary trimming is a heuristic: the first month is excluded if its earliest selected-satellite record is after day 7, and the final month is excluded if its latest record precedes the calendar month's final day. Partial country archives still require independent completeness checks.

SO₂ is an annual point-source emissions catalogue, not monthly concentration. For compatibility, annual values are repeated across 12 display positions, with `temporal_resolution: "annual"`. The application must exclude these from monthly anomaly and significance calculations. Regeneration requires every catalogue source assigned to a region to have a finite value for that year; otherwise the region-year is null. Point assignment uses the 0.5° mask and is approximate near boundaries.

## Merge and publish

Prepare the existing pinned website bundle before merging newly built layers. The merger preserves unrelated layers, adds gaps as JSON nulls, and exports temporal resolution and processing metadata:

```sh
cd web
npm ci
npm run setup
cd ..
pipeline/.venv/bin/python -I pipeline/merge_series.py aod to3_m2 tqv
# For an existing layer extension, preserve its established region availability:
pipeline/.venv/bin/python -I pipeline/merge_series.py --only-existing p_m2land et_m2land sm_m2 ro_m2 rn_m2 tsurf_m2
```

Only merge layers whose intermediates you deliberately built. Avoid `--all` if the intermediate directory contains validation-only layers such as `p_imerg_check`. The merger does not rebuild legacy `trends/`, `results/`, or the separate GLDAS Explore inputs in `web/data`. `/detective/` computes its statistics from the updated series; treat the other products as separate snapshots until their pipelines are rerun.

After updating the catalogue and series, generate the release manifest with the intended new version:

```sh
pipeline/.venv/bin/python -I pipeline/build_manifest.py data-YYYY-MM-DD
```

This checks series files, finite numeric/null values, and catalogue/index consistency, then writes `catalog/manifest.json`. Invalid assets return exit code 1 with asset-specific reasons; pending event catalogues and indicator recipes do not invalidate otherwise usable series. Per-layer entries retain temporal resolution, caveats, and monthly-analysis eligibility. SO₂ can be a structurally ready annual asset while remaining ineligible for monthly analysis. Point-product limitations are separate from the gridded 30% coverage rule. The manifest describes the current MVP's query-time baseline and does not certify scientific reproducibility. Use the same dataset version for the manifest and Release asset, and include the generated manifest in the bundle.

Inspect coverage, null patterns, units, source metadata, and representative regional values before publishing. Package both `web/data` and `web/public/data` into a new Release asset, excluding generated `public/data/gen` and the old `.bundle` marker; calculate the asset SHA-256 and update `web/data.lock.json`. Keep processed datasets in that versioned asset rather than adding them back to Git. Re-run host setup from the new lockfile and rebuild the website image.

The imported F snapshot was produced before these regression fixes. Its existing numbers have not been regenerated from the original FIRMS or SO₂ inputs here. In particular, old SO₂ missing source-years may already have been converted to zero, and old FIRMS zeroes do not establish archive completeness. Updating metadata or pipeline code does not retroactively repair those values. Preserve this qualification in release provenance until the original inputs are obtained and the affected layers are rebuilt.
