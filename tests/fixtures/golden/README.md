# Golden fixtures — the frozen numerical baseline

These JSON files are **committed artifacts**, not build output. They record what
the engine computes for a fixed set of scenarios, and they are the numerical
contract of the engine: any change to `sae_app/` that moves a number shows up
here first.

`tests/test_engine_golden.py` replays each file through the engine and compares:

| Value type | Rule |
| --- | --- |
| floats (probabilities, scores, distances) | absolute tolerance `1e-12` |
| ints, bools, strings, `null` | exact |
| keys, list lengths, ordering | exact |

## What is in here

| File pattern | Scenarios | Frozen output |
| --- | --- | --- |
| `strict_*.json` | 6 strict lists: 1, 3, 4, 8 and 12 wishes; one wish per SAE priority criterion, each flag set alone on a program where the engine really grants that tier; the already-enrolled flag; a program with imputed 2024 calibration; a program with zero admission seats | every column of `mtb_engine.availability` plus the three cumulative columns, the predicted outcome, its final chance, the unmatched risk and the at-risk flag |
| `equiv_*.json` | 4 equivalence lists: 2 tied long shots behind a near-certain program (2 orders, the *stable* case on a non-zero unmatched risk), two groups of three (36 orders, the outcome itself changes), a group of four tying a near-certain program to three long shots (24 orders, same outcome but a large probability shift), and eight tied programs (40,320 — above `MAX_EXACT_EQUIV_PERMUTATIONS`, so it is rejected) | `total_orders`, the reference choices table, and per variant: the order as program ids, the predicted outcome, its final chance, the unmatched risk and the at-risk flag |
| `recommend_*.json` | 3 recommendation runs on one Santiago list: no home; a fixed Rapa Nui coordinate at `address` precision (the 100 km hard filter applies and leaves only the two island schools); the same coordinate at `city` precision (no cutoff, so three mainland candidates ~3,550 km away come back) | the recommendation rows including the raw `_`-prefixed columns, the current unmatched risk, and `diagnostics` |
| `identifier_*.json` | 5 RUN/IPE cases: valid RUN, dotted RUN, invalid check digit, valid IPE, garbage | the normalized identifier, or the error class plus its untranslated `message_key` |
| `_generation_metadata.json` | provenance only — student identifiers, selected programs, library versions | not compared by the tests (files starting with `_` are skipped) |

## What the generator refuses to write

A fixture is only worth committing if a broken implementation would fail it.
`verify_coverage` in `tests/generate_golden.py` therefore computes every
scenario *before* touching this directory and aborts, leaving the committed
baseline untouched, when:

1. any of the four SAE priority tiers (or `no_priority`) never appears in a
   frozen `priority_tier` column — the flags must be set on programs where
   `resolve_priority_tier` really grants the tier and the priority share moves
   the effective rank, otherwise a regression in tier resolution would still
   reproduce every fixture;
2. `equiv_01` stops being the *stable* sensitivity case on a real risk: one
   predicted outcome that is not `Unmatched`, the same final chance in every
   order, and an unmatched risk strictly between 0 and
   `HARD_UNMATCHED_THRESHOLD`; or `equiv_03` stops being the *same outcome,
   shifted probability* case (one outcome, chance range at least
   `EQUIV_PROBABILITY_CHANGE_WARNING_THRESHOLD`) — between them and `equiv_02`
   all three equivalence-sensitivity verdicts are frozen;
3. the `address`- and `city`-precision recommendation runs return the same
   programs — that would mean the hard distance filter excluded nothing and the
   precision branch is untested.

One thing no fixture can show: the unmatched risk moving between the strict
orders of one equivalence class. It is the product of `1 - availability` over
the same set of wishes, so it is invariant by construction — the per-variant
values differ only by floating-point reassociation, far below the `1e-12`
comparison tolerance. The sensitivity block is about the predicted outcome and
its final chance.

Every program is a real row of `data/capacities_2025_wta_with_2024_calibration.csv`,
chosen by the stable rules documented in `tests/generate_golden.py`
(`select_programs`), and stored with both its `program_id` (`rbd:program_code`)
and its display label. The RUN/IPE are synthetic; the RUN check digit is derived
from `mtb_engine._run_check_digit`. Nothing here was geocoded: the "home"
location is a fixed coordinate pair handed straight to
`recommend_similar_programs`, so generating and running these fixtures never
touches the network.

## Regenerating

```bash
.venv/bin/python tests/generate_golden.py
.venv/bin/python -m pytest -q
```

The generator is deterministic: on unchanged data and unchanged library versions
it rewrites byte-identical files (`git status` stays clean).

**A regeneration that changes any number changes what the product tells a
family.** These files are the only place such a change is visible, so a change
here is a decision, not a chore:

1. Establish *why* the numbers moved (a data refresh, a pandas/scipy upgrade, or
   a genuine engine change) and confirm it is intended.
2. Commit the regenerated fixtures on their own, with a commit message that
   states the date, the cause, which fixtures changed, and who accepted the new
   baseline. Never bundle a regeneration with unrelated work.

Never edit a fixture by hand to make a test pass.
