# Store test fixtures — TEST DATA ONLY

`store_support.py` writes a miniature data release (three regions, four layers, a small catalogue) into a
temporary directory. Every number in it is an arbitrary test value chosen to exercise the adapter and the
validation rules (nulls, zeros, gaps, unsupported cadence, unit mismatch, missing files).

Nothing here is a NASA product, an observation or a scientific result, and none of it is read by shipped code.
