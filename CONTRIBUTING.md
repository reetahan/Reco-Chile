# Contributing to Reco Chile

Conventions for working in this repository, including the frontend style guide.

## What this is

Reco Chile estimates a student's assignment probabilities in Chile's *Sistema de
Admisión Escolar* (SAE). Three layers, one direction of dependency:

- **`sae_app/`** — the Python calculation engine. The source of truth for every
  number. No UI dependency of any kind.
- **`api.py`** — a thin FastAPI adapter over the engine. The only backend.
- **`web/`** — a Next.js (App Router) + shadcn/ui wizard. It formats and
  explains; **it never computes a probability**. Thresholds and option lists
  come from `GET /meta`; duplicating a constant in TypeScript is a bug.

`README.md` documents the risk model (MTB hash → priority-adjusted rank →
hypergeometric availability → cumulative assignment probability). Read it before
touching `mtb_engine.py`. `docs/architecture.md` is the wire contract and the
wizard state model.

## Commands

### Python (engine + API)

```bash
python -m venv .venv && source .venv/bin/activate
.venv/bin/python -m pip install -r requirements.txt -r requirements-dev.txt

.venv/bin/python -m uvicorn api:app --reload   # the backend for web/
pytest                                         # golden engine tests + API contract tests
python scripts/export_openapi.py               # regenerate web/lib/api/openapi.json
```

`pytest` must stay green. The golden fixtures under `tests/fixtures/golden/`
are the engine's numerical contract — see [Tests](#tests).

### Web

```bash
cd web
pnpm install
pnpm dev                                       # expects API_BASE_URL (default http://localhost:8000)
pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm e2e
pnpm api:types                                 # openapi.json -> lib/api/schema.d.ts
```

Node ≥ 20, pnpm from `package.json`'s `packageManager` field. `pnpm e2e` starts
both uvicorn (from the repo `.venv`) and `next dev` itself. `web/README.md` has
the full detail on the API client, the proxy, Docker and CI.

### Python on macOS

`/usr/bin` precedes `/opt/homebrew/bin` in a default PATH, so a bare `python3`
is system Python 3.9 and **`api.py` cannot import under it**: its pydantic
models use PEP 604 unions (`int | None`) with `from __future__ import
annotations`, so pydantic evaluates them as strings at runtime and 3.9 raises
`TypeError`. Requires 3.10+; use the repo's `.venv` interpreter by path — that
is exactly what `web/playwright.config.ts` does.

Dependencies are plain `requirements.txt` with `>=` lower bounds, deliberately —
no lockfile, no project-manager config, so collaborators are not pushed onto any
one tool. The tradeoff is that installs are not reproducible: a fresh install
resolves to pandas 3.x / numpy 2.x. Smoke-tested against pandas 3.0.5 /
numpy 2.5.2 / scipy 1.18.0 on Python 3.12.13.

## Frontend style guide

These are product decisions made by reviewing the running app. Where this section
and `docs/architecture.md` disagree about copy or layout, this section wins. When
adding or editing any family-facing string, check it against all of them.

### Voice

1. **Second person, always.** "you" / "your" / "tú". Never "the family", "the
   student", "the applicant". Step titles use the possessive: *Your details*,
   *Build your list*, *Review your results*, *Improve your list* — "your", not
   "the".
2. **Positive framing.** The tool *calculates your chances*; it does not
   "review the risk of your list". No alarm vocabulary in user-facing copy —
   "risk", "attention level", "warning", "unmatched risk" are out. (The engine
   and the API still use those names internally; only the copy is reframed.)
   Warnings that report an actual *failure* stay — an empty result or a request
   that errored still has to say so.
3. **No jargon.** Never surface: MTB / tie-break lottery, modulo-11 check digit,
   equivalence class, strict ranking, attention level, calibration thresholds,
   percentile. Say what the thing does instead — "Use this option to compare
   different possible rankings of your programs."
4. **Say it once.** No helper line under an input that repeats the label or the
   popover; no lead sentence that repeats a caveat already shown below it. If a
   sentence appears twice on a screen, delete one.
5. **Show the answer, not the method.** Step 3 is one box: the most likely
   program, its location, which preference it is, the estimated chance, and a
   one-line caveat. Nothing else belongs there — see
   `docs/architecture.md`, "Product decisions that shape the UI".

### Layout of information

6. **Explanations live behind an info affordance**, never as a standing
   paragraph. The pattern is a `?`/info icon button next to the label that opens
   a popover — `components/student/why-we-ask.tsx` ("Why do we ask for this?")
   and `components/list/equivalence-switch.tsx` ("What does this mean?"). Copy
   that a reader only sometimes needs goes there.
7. **A control that *is* the page's question stays out in the open.** Step 4
   opens with the recommendation-count slider (default 3), not with a
   disclosure hiding it.
8. **Consent is its own screen.** `/[locale]/disclaimer` — the two "keep in
   mind" points and a checkbox that gates step 1. Legal caveats are not
   sprinkled into the form steps.
9. **Every program is named with its commune and region**, both, everywhere it
   is listed or chosen: combobox rows, wish cards, recommendation cards, the
   result box, the finish page. Several hundred Chilean schools share a name.
   The rule and its single documented exception live in
   `web/components/list/program-location.ts`; import from there rather than
   formatting a location line by hand.

### Visual

10. **Theme:** `web/app/globals.css`. Accent `#1F6FEB`, white background,
    `#F6F7F9` secondary surface, `#16191D` text, `#E4E7EB` hairline borders,
    `0.5rem` radius, no webfont (system sans). Base text is 15px via
    `--text-base`, not via the root font size, so Tailwind's spacing scale stays
    on a 16px rem — keep it that way. Light mode is the only mode in practice;
    `.dark` tokens exist but nothing toggles them. In shadcn's token
    vocabulary `--accent` is the neutral hover surface — the brand accent is
    `--primary`; do not remap it.
11. **shadcn primitives in `web/components/ui/` are generated and not
    hand-edited**, with one documented exception: `button.tsx` uses
    `rounded-full`. Re-apply that after regenerating.
12. **One centred column.** The step title is the page's only `<h1>`; the header
    brand is a `<p>`; sections below open at `<h2>`. Spacing is flex + `gap-*`,
    not margins. Prominent results go in a `Card`; secondary lines use
    `text-muted-foreground`; lucide icons are decorative and get
    `aria-hidden="true"`.
13. **Keyboard operability is a requirement, not a nice-to-have.** Strict-mode
    reordering offers drag-and-drop **and** up/down buttons; focus moves to the
    `<h1>` on a step change (`components/wizard/step-page.tsx`). `pnpm e2e`
    includes an axe pass (`e2e/a11y.spec.ts`).

## Web conventions

- Wizard steps: `web/app/[locale]/(wizard)/{student,list,result,improve}/page.tsx`.
  The stepper, the step guard and the Back/Continue bar live in the group
  layout. Outside the group and outside the stepper: `/[locale]` (welcome),
  `/[locale]/disclaimer`, and `(wizard)/finish` (rendered without the rail).
- Step components go in `web/components/{student,list,result,improve}/`, shared
  wizard chrome in `web/components/wizard/`.
- **State lives in `web/lib/store/wizard.ts`** (zustand). It is the source of
  truth for the reachability rules (`canEnterStep`, `canContinue`) and for the
  invalidation rules, which are documented as a table in its module docstring.
  Any new input that affects results needs a row there and an invalidation.
- `studentId`, the simulation result and the geocoded home are **never
  persisted** — no `localStorage`/`sessionStorage`, no URL params. Only
  `wishes`, `listExists`, `useEquivalenceClasses`, `disclaimerAcknowledged` and
  `filters` go to `sessionStorage`.
- The browser reaches FastAPI **only** through the route handler
  `web/app/api/[...path]/route.ts` (logic in `lib/api/upstream.ts`). Never
  hard-code the Python origin in client code, and **never log a request body**
  there — bodies carry the RUN/IPE and the home address.
- `lib/api/openapi.json` and `lib/api/schema.d.ts` are generated, never
  hand-edited: change `api.py`, run `scripts/export_openapi.py`, then
  `pnpm api:types`.
- The address is sent to `/geocode` only on an explicit button click.
- The store's `simulation` is dropped, not merely flagged stale, when an input
  changes — a stale number must never be on screen.

## Engine and API conventions

### The program label is the join key (engine) — the program id is the join key (wire)

`build_program_mapping(calib)` returns an ordered `dict[display_label,
pd.Series]`. That human-readable label — not the RBD or program code — is what
wish-list DataFrames store in the `PROGRAM` column, and how every downstream
lookup finds a program row. `make_program_option_label` disambiguates duplicates
by appending detail and finally `· code <program_code>`, so labels are stable
within one loaded dataset but change if the data or the labelling rules change.

`api.py` layers a stable public identifier over this: `program_id =
f"{rbd}:{program_code}"`, with `id_to_label` / `label_to_id` built at startup.
HTTP callers — `web/` included — never see labels except as `program_label`, and
`web/` stores only `program_id`s.

### Caching

`sae_app/cache.py` is plain-stdlib memoisation. The CSV loaders are keyed on
**file bytes**, not paths — which is why `load_calibration` reads and passes the
bytes of all four CSVs explicitly. Geocoding uses a TTL cache. Recommendation
candidate metrics use a per-request `CandidateRiskCache`; its key deliberately
excludes the student identifier — keep it that way.

### i18n contract

- **Python (`sae_app/i18n.py`)**: English source strings *are* the translation
  keys. `t(key, lang=...)` looks the string up in `TRANSLATIONS["es"]` and falls
  back to the key unchanged when missing. `lang` is always explicit. It is used
  for **API error messages only** — every other user-facing string lives in
  `web/messages/`. Editing an English string silently breaks its Spanish
  translation — update both.
- **Web (`web/messages/{es,en}/*.json`)**: semantic keys
  (`result.outcome.chance`), one file per namespace, merged in `index.ts`. Both
  locales must have identical key sets — a Vitest test enforces it. Spanish is
  the default and the locale the product copy is reviewed in; write it first.
  Enumerated API values (filter options, priority tiers, `Unmatched`) are
  translated under `enums.*`; school names, communes and program display names
  are shown verbatim; API `message` fields are shown as-is.

The API never returns translated enumerated values — only `message` is
language-dependent (`?lang=` / `Accept-Language`, default `es`).

### Error handling

`MtbEngineError` subclasses (`sae_app/errors.py`) carry a `message_key` plus
`message_kwargs` and are **not** pre-translated. The presentation layer
translates: `_engine_error` in `api.py` returns 422 with `{error_key, message,
params}`. Raise typed engine errors from calculation code; never call `t()`
there. `web/` shows `message` and may branch on `error_key` (e.g.
`too_many_equivalence_orders`); a transport failure surfaces as `ApiError` with
`errorKey === NETWORK_ERROR_KEY`.

### Column names and thresholds

Every data column name, threshold, file path and filter option list lives in
`sae_app/constants.py`. Use the constants (`PROGRAM`, `WISH_RANK`,
`EQUIV_GROUP`, `CAPACITY`, `POP`, `MAX_WISHES`, …), not string literals — the
CSV column names do not match the Python identifiers.

### Equivalence-class pipeline

Availability depends only on the program and the student's priority flags, never
on list position. So: `prepare_ordered_wishes` → `count_equivalence_orders`
(rejected above `MAX_EXACT_EQUIV_PERMUTATIONS = 10000`) →
`precompute_equivalence_availability` once, keyed by
`wish_availability_cache_key(wish) = (program_label, priority_flags)` →
`iter_equivalence_orders` → `compute_equivalence_order_from_precomputed` per
permutation, which only recomputes the cumulative products. **Never call
`availability()` inside the permutation loop.**

`api.py` always runs this pipeline: a wish without an explicit
`equivalence_group` becomes a singleton group equal to its position, which is
mathematically identical to strict ranking, so one code path covers both modes.

### Data validation

`api.py` runs `required_cols()`, `validate_core_numeric_columns` and
`validate_cumulative_share_columns` in `validate_calibration` at lifespan and
raises `RuntimeError`, so uvicorn refuses to start on bad data.

## Tests

- `pytest` — engine golden tests + API contract tests.
- `cd web && pnpm test` (Vitest) and `pnpm e2e` (Playwright, starts both halves
  of the stack).
- `tests/golden_runner.py` is the single implementation of the calling
  convention the fixtures were frozen at, shared by `tests/generate_golden.py`
  and the golden tests. `api.py` reaching the same numbers by a different path is
  the point. When the engine's calling convention changes, update the runner —
  **never the fixtures**.
- Regenerating `tests/fixtures/golden/` means the numbers the product shows a
  family changed. It needs a deliberate decision and its own commit, with a
  message saying why (see the README in that directory).

## Privacy constraints in the code

- The RUN/IPE is used only to compute `SHA-256(normalized_id + normalized_rbd)`.
  The hash input and the hex digest are local temporaries and are deliberately
  never attached to a DataFrame (`attach_mtb_hashes` even drops legacy
  `lottery_hash_input` / `lottery_hash_hex` columns). Preserve this when
  touching `mtb_engine.py`.
- The RUN/IPE never reaches browser storage or the URL, and the Next.js proxy
  never logs a request body.
- The only outbound network call is Nominatim geocoding, throttled to 1 req/s
  per process by `geo.py` and triggered only by an explicit user action. The
  throttle is per process — run one uvicorn worker, or add shared throttling
  before scaling.
