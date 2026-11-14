# TEST fixtures for the IndicatorRegistry

Everything in this folder is **test data**. Nothing here is an observation, a NASA product or a real event record.

| File | Content |
| --- | --- |
| `spi_reference_climate_indices.json` | Synthetic monthly precipitation rates (seeded random numbers) and the SPI-3/6/12 values computed for them by the independent `climate-indices` package (version recorded in the file). Used to verify `aqua_trend.indicators.spi` numerically. |
| `recorded_events_test.json` | Invented event catalogues, events and coverage records that exercise the recorded-event rules (E02, E05, E06, E07, E11, E12). Event ids, dates and metrics are made up. |
