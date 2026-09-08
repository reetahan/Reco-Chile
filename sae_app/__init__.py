"""SAE admission-risk simulator — the calculation engine.

Every number the product shows is computed here. The package has no UI
dependency of any kind: `api.py` at the project root is a thin HTTP adapter over
these modules, and the Next.js wizard in `web/` only formats what the API
returns. CI guards the no-UI-dependency property with an import-isolation check
on `api`.

- constants:        static configuration (columns, thresholds, file paths, dropdown options)
- cache:            stdlib memoisation for the CSV loaders and the geocoder
- i18n:             the ES/EN translation dictionary and the t() helper
                    (API error messages only; `web/` owns every other string)
- text_utils:       small, dependency-free text/number cleaning helpers
- data_loading:     reading and validating the CSV data files
- program_options:  ProgramRecord + building/filtering the program list
- errors:           typed calculation errors, translated only by the caller
- mtb_engine:       the SHA-256 lottery hash + hypergeometric availability model
- wish_list:        wish-list parsing, cleaning, and equivalence-class handling
- geo:              coordinates, distance, and address geocoding
- recommendations:  the "similar programs" portfolio-risk recommendation engine
"""
