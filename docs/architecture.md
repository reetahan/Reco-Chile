# Architecture

Design reference for the three layers of Reco-Chile: the Python calculation
engine (`sae_app/`), the FastAPI adapter (`api.py`), and the Next.js wizard
(`web/`). `README.md` covers the risk model and the data files; `CONTRIBUTING.md`
covers day-to-day conventions and the frontend style guide. This document is the
wire contract and the state model.

## Design decisions

| Topic | Decision | Consequence |
| --- | --- | --- |
| Calculation engine | Python is the single source of truth for every number. | No numerical logic lives in TypeScript. The frontend never computes a probability. |
| Repo layout | Monorepo — `web/` sits next to `sae_app/`. | One PR flow; the TypeScript API types are generated from the FastAPI OpenAPI schema. |
| Wizard | Four steps: 1 Student · 2 Build list · 3 Result · 4 Improve. | Mode choices ("list exists?", "undecided ties?") live in step 1/2. Step 4 feeds back into step 2. |
| UI language | Spanish default, English switchable. | Family-facing copy lives in `web/messages/{es,en}/`; the API keeps a small `t()` for error messages only. |

## Runtime shape

```
browser ──HTTP/JSON──▶ web/ (Next.js, shadcn/ui)   ──HTTP/JSON──▶ api.py (FastAPI)
                        · wizard state (client)                    · sae_app/ engine
                        · i18n (next-intl, es/en)                   · in-process caches
                        · generated API client                     · Nominatim (geocode only)
```

- The browser talks to FastAPI **only** through the Next.js route handler
  `web/app/api/[...path]/route.ts` (logic in `web/lib/api/upstream.ts`), which
  forwards `/api/<anything>` to `${API_BASE_URL}/<anything>`. One origin means no
  CORS in production, the RUN/IPE stays first-party from the browser's point of
  view, and the Python port need not be published. In development the proxy
  points at `http://localhost:8000`.
- FastAPI is stateless per request. All calibration data is loaded once at
  startup (`lifespan`), validated, and held in `STATE`; uvicorn refuses to start
  on bad data.
- The engine is the only place probabilities are computed. The frontend formats
  and explains; it never recomputes cumulative products.

## API contract

All endpoints are under the FastAPI app; the Next.js proxy forwards them 1:1.
Language: `?lang=es|en` (default `es`) or `Accept-Language`. Only `message`
fields are language-dependent; every enumerated value stays an English internal
code (`"With PIE"`, `"priority_sibling"`, `"Unmatched"`), which the frontend
translates from `web/messages/`.

Error format, everywhere: HTTP 422 with
`{"error_key": str, "message": str, "params": {}}`. `error_key` is the English
source string or a stable snake_case key; the frontend shows `message` and may
special-case `error_key`.

| Method / path | Purpose | Notes |
| --- | --- | --- |
| `GET /health` | liveness | — |
| `GET /meta` | thresholds (`hard_unmatched_threshold`, `soft_unmatched_threshold`, `equiv_probability_change_warning_threshold`), `max_exact_equiv_permutations`, `max_wishes`, `recommendation_max_home_distance_km`, filter option lists, `regions`, data fingerprint (hash of the 4 CSVs) | the frontend reads this once; no threshold is hard-coded in `web/` |
| `GET /regions` | region names | superseded by `/meta`, kept for compatibility |
| `GET /programs` | `region`, `q`, `limit`, `offset`, plus repeatable filter params `track`, `specialty_sector`, `gender`, `school_day`, `rurality`, `pie`, `pace`, `enrollment_fee`, `monthly_fee`, `religious_orientation` | filter semantics = `program_matches_filters`; items carry `calibration_imputed: bool` and the program-detail fields |
| `GET /programs/{program_id}` | one program with all display fields | used by wish cards, so the store only holds `program_id`s |
| `POST /simulate` | body: `student_id`, `wishes[]` (optional `equivalence_group` + 5 priority flags; at most `MAX_WISHES` = 30 wishes, exposed as `/meta.max_wishes`). Response: per-wish results, `attention_level`, `thresholds`, `outcomes[]` (sorted by probability, includes `Unmatched`), per-wish `lottery_number`, `priority_tier`, `lottery_population_used`, `calibration_imputed`; `equivalence_sensitivity` with `verdict: "stable"｜"stable_probability_shift"｜"outcome_changes"`, `predicted_chance_min/max`, and per-variant `tied_order: [[program_id, …], …]` | one code path covers strict and ties: a wish without an explicit `equivalence_group` becomes a singleton group |
| `POST /recommend` | body: `student_id`, `wishes[]`, `max_recommendations` (2–10), optional `home: {lat, lon, precision}` | the server re-runs the simulation internally for the current unmatched risk (no client-supplied risk); response carries `distance_reference: "home"｜"list"`; items carry raw numbers (`chance_if_considered`, `projected_unmatched_risk`, `distance_km`, `capacity`, `applicants_per_seat`, `estimated_mtb_rank`, `score`, `risk_level`) plus `similarity_fallback_mode`, `hard_distance_filter_applied`, `diagnostics.failed_candidates` |
| `POST /geocode` | body: `address` | wraps `geocode_chilean_address`; response `{ok, lat, lon, precision, display_name, warning_key, error_key, params}`. Nominatim is throttled to 1 req/s per process server-side, with a per-IP rate limit in front |

Contract rules:

- Program identity on the wire is always `program_id = f"{rbd}:{program_code}"`.
  Display labels are derived server-side (`build_program_mapping`) and returned
  as `program_label`; the frontend never reconstructs them.
- `MAX_EXACT_EQUIV_PERMUTATIONS` is enforced server-side (422
  `too_many_equivalence_orders`) and pre-checked client-side from `/meta` so the
  Continue button can disable itself with the same message.
- `web/lib/api/openapi.json` is the committed FastAPI schema and
  `web/lib/api/schema.d.ts` is generated from it. Regenerating is a build step
  (`scripts/export_openapi.py`, then `pnpm api:types`), never a manual edit.

## Wizard state (`web/lib/store/wizard.ts`)

```ts
type Wish = {
  programId: string
  equivalenceGroup: number | null   // null in strict mode
  prioritySibling: boolean
  priorityStudent: boolean
  priorityParentCivilServant: boolean
  priorityExStudent: boolean
  priorityAlreadyRegistered: boolean
}
```

The store is the source of truth for the step-reachability rules (`canEnterStep`,
`canContinue`) and for the invalidation rules below. A stale number must never be
on screen, so an input change **drops** the cached simulation, it does not merely
flag it.

| Change | Effect |
| --- | --- |
| `studentId` changes | `simulation = null`, `simulationStale = true` |
| `useEquivalenceClasses` toggles | wishes kept; `equivalenceGroup` reset to `null` (strict) or to position (ties); simulation invalidated |
| any wish add / remove / reorder / group / flag change | simulation invalidated |
| a `programId` disappears from the data (404 after a data change) | wish dropped (caller shows the toast), simulation invalidated |
| recommendations appended | trailing singleton groups (ties) or trailing ranks (strict), never past `maxWishes`; simulation invalidated; navigate to step 2 with a toast |

Persistence: only `wishes`, `listExists`, `useEquivalenceClasses`,
`disclaimerAcknowledged` and `filters` go to `sessionStorage`. `studentId`, the
simulation result and the geocoded home are memory-only.

## i18n

- `next-intl` with a `[locale]` segment, `es` default, `en` secondary; the
  locale switcher is in the header.
- Keys in `web/messages/{es,en}/*.json` are semantic IDs (`result.outcome.chance`),
  one file per namespace, merged in `index.ts`. Both locales must have identical
  key sets (a Vitest test enforces it). Spanish is written first — it is the
  locale the product copy is reviewed in.
- Enumerated API values (filter options, priority tiers, `Unmatched`) are
  translated under `enums.*`. School names, communes and program display names
  are shown verbatim. API `message` strings are shown as-is (already localized
  by the server via `?lang=`).
- Python (`sae_app/i18n.py`): English source strings *are* the translation keys;
  `t(key, lang=...)` falls back to the key when a translation is missing. Used
  for API error messages only.

## Privacy rules

- The RUN/IPE lives in React state only — never in the URL, `sessionStorage`,
  `localStorage`, or a log. The Next.js proxy never logs a request body, and
  never copies a body field into a header; request bodies carry the RUN/IPE
  (`/simulate`, `/recommend`) and the home address (`/geocode`).
- The RUN/IPE is used only to compute `SHA-256(normalized_id + normalized_rbd)`.
  The hash input and digest are local temporaries, never attached to a DataFrame.
- The address is sent to `/geocode` only on an explicit button click, never on
  change.
- No analytics. Next.js' own telemetry is disabled (`NEXT_TELEMETRY_DISABLED=1`)
  in the `dev` / `build` / `start` scripts.
- The only outbound network call is Nominatim geocoding, throttled to 1 req/s per
  process and triggered only by an explicit user action. The throttle is per
  process — run one uvicorn worker, or add shared throttling before scaling.

## Product decisions that shape the UI

These were made by reviewing the running app and override a naive one-to-one
port. The durable rules live in `CONTRIBUTING.md`'s frontend style guide; the
highlights:

- **Welcome screen.** The wizard opens on `/[locale]` with a positive-framing
  headline and the "do you already have a list?" choice as two buttons, then a
  consent screen (`/[locale]/disclaimer`), then step 1.
- **Second-person, positive framing.** "you" / "tú" everywhere; the tool
  *calculates your chances* rather than "reviews the risk of your list". Alarm
  vocabulary ("risk", "attention level", "warning") stays out of family-facing
  copy; the engine and API still use those names internally.
- **Step 3 is one box.** The most likely program, its commune and region, which
  preference it is, the estimated chance, and a one-line caveat. The overall
  assignment figure, the outcome list, the per-preference table, the equivalence
  sensitivity block and the detailed calculation were all removed.
- **Most likely = `outcomes[0]`.** `outcomes[]` is sorted by probability and
  always contains `Unmatched`, so its first entry is the most likely outcome.
  (`predicted_outcome` is a different thing — an alert trigger that flips to
  `Unmatched` at the hard threshold — and is not what the headline reads.)
- **No jargon.** MTB / tie-break lottery, modulo-11 check digit, equivalence
  class, percentile, calibration thresholds — none of these are surfaced. Say
  what the thing does instead.
- **Explanations live behind an info affordance**, never as a standing
  paragraph. Every program is named with its commune and region everywhere it is
  listed.

## Intentional deviations from a naive port

Recorded so a side-by-side review does not report them as bugs:

- Identifiers accept ASCII digits only — the `sae_app/mtb_engine.py` regexes use
  `[0-9]` (not `\d`) so the server and the client agree.
- `MAX_WISHES = 30` cap on the preference list.
- Spanish percentages use a comma decimal separator (`54,8%`); the digits are
  identical to English, only the punctuation is localized.
- `/meta` is fetched in the `(wizard)` group layout, not the root layout, so the
  welcome and consent pages stay backend-free.
