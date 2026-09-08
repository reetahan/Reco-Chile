"""FastAPI entry point — API contract v1.

A thin HTTP adapter over the ``sae_app`` engine: it translates HTTP requests
into engine calls and formats the results as JSON. No probability is computed
here.

Note /simulate always runs the equivalence-class pipeline. A wish without an
explicit equivalence_group is its own singleton group (equal to its position),
which is mathematically identical to strict ranking, so this covers both
modes without a separate code path.

Language: every ``message`` field is localized from the request's ``lang``
query parameter or ``Accept-Language`` header (default ``es``). Every other
value — ``error_key``, filter options, priority tiers, ``"Unmatched"`` — stays
an English internal code the frontend translates itself.

Logging: nothing here logs a request body, and the access log must not either.
Uvicorn's access line is ``client - "METHOD path HTTP/1.1" status`` — method,
path and query string only, never the body — and the student's RUN/IPE and the
family's home address only ever travel in POST bodies, so
the default access log is safe as it stands. Keep it that way: do not move an
identifier into a path or query parameter, and do not add body logging or a
``--log-config`` that dumps requests. ``tests/test_api_contract.py`` runs a
real uvicorn server and asserts the RUN never reaches a ``uvicorn.access``
record.

Run with: uvicorn api:app --reload
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
from contextlib import asynccontextmanager

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import http_exception_handler as default_http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from sae_app.constants import (
    MAX_WISHES,
    CAPACITIES_PATH,
    CAPACITY,
    EQUIV_GROUP,
    EQUIV_PROBABILITY_CHANGE_WARNING_THRESHOLD,
    GENDER_FILTER_OPTIONS,
    GEOCODE_RATE_LIMIT_REQUESTS,
    GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
    HARD_UNMATCHED_THRESHOLD,
    IMPUTED,
    LOTTERY,
    MAX_EXACT_EQUIV_PERMUTATIONS,  # this cap exists to avoid combinatorial explosion of permutations
    PACE_FILTER_OPTIONS,
    PAYMENT_FILTER_OPTIONS,
    PIE_FILTER_OPTIONS,
    PRIORITIES,
    PROGRAM,
    PROGRAM_DISPLAY_NAME,
    PROGRAM_ENROLLMENT_FEE,
    PROGRAM_FILTERS_PATH,
    PROGRAM_GENDER,
    PROGRAM_MONTHLY_FEE,
    PROGRAM_NAMES_PATH,
    PROGRAM_PACE,
    PROGRAM_PIE,
    PROGRAM_RELIGIOUS_ORIENTATION,
    PROGRAM_RURALITY,
    PROGRAM_SCHOOL_DAY,
    PROGRAM_SPECIALTY_SECTOR,
    PROGRAM_TRACK,
    RBD_REGION_PATH,
    REGION,
    RELIGIOUS_FILTER_OPTIONS,
    RURALITY_FILTER_OPTIONS,
    SAFETY,
    SCHOOL_COMMUNE,
    SCHOOL_DAY_FILTER_OPTIONS,
    SCHOOL_NAME,
    SOFT_UNMATCHED_THRESHOLD,
    SPECIALTY_FILTER_OPTIONS,
    TRACK_GENERAL,
    TRACK_SPECIALIZED,
    TRUE_APP,
    WISH_RANK,
)
from sae_app.data_loading import (
    available_regions,
    load_calibration,
    program_matches_filters,
    required_cols,
    validate_core_numeric_columns,
    validate_cumulative_share_columns,
)
from sae_app.errors import CandidateEvaluationError, MtbEngineError
from sae_app.geo import (
    geocode_chilean_address,
    geocoding_precision_warning_key,
    home_geocoding_supports_hard_filter,
)
from sae_app.i18n import DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, t
from sae_app.mtb_engine import (
    compute_equivalence_order_from_precomputed,
    normalize_student_identifier,
    precompute_equivalence_availability,
)
from sae_app.program_options import build_program_mapping
from sae_app.recommendations import (
    RECOMMENDATION_COMPETITION_WEIGHT,
    RECOMMENDATION_DISTANCE_SCALE_KM,
    RECOMMENDATION_DIVERSIFY,
    RECOMMENDATION_DIVERSITY_STRENGTH,
    RECOMMENDATION_FAVOR_LESS_OVERSUBSCRIBED,
    RECOMMENDATION_HARD_CONSTRAINT_COLS,
    RECOMMENDATION_MAX_HOME_DISTANCE_KM,
    RECOMMENDATION_MIN_SIMILARITY_SCORE,
    RECOMMENDATION_PROXIMITY_WEIGHT,
    RECOMMENDATION_RISK_OPTIMIZATION_WEIGHT,
    SCHOOL_NAME_UNAVAILABLE,
    recommend_similar_programs,
)
from sae_app.text_utils import as_bool
from sae_app.wish_list import (
    count_equivalence_orders,
    iter_equivalence_orders,
    predicted_outcome_final_chance,
    predicted_outcome_from_choices,
    prepare_ordered_wishes,
)

STATE: dict = {}

API_VERSION = "1.0.0"

# The wire cap on a wish list (MAX_WISHES), mirrored by /meta so the frontend
# can disable the control with the same number instead of hard-coding one,
# lives in constants.py; it is imported above.

# How many individual problems a startup validation failure spells out before
# it stops and reports the remainder as a count.
MAX_REPORTED_VALIDATION_PROBLEMS = 10

# The per-IP geocoding budget (GEOCODE_RATE_LIMIT_REQUESTS / _WINDOW_SECONDS)
# lives in constants.py with every other threshold; it is imported above.

# Hosts whose X-Forwarded-For header may be believed. In the recommended
# deployment the only client of this service is the Next.js proxy on the same
# host, so every request arrives with request.client.host == the proxy and the
# raw socket address is useless as a rate-limit key. Override with
# SAE_TRUSTED_PROXIES (comma-separated) when the proxy sits on another host.
DEFAULT_TRUSTED_PROXIES = "127.0.0.1,::1"

# Literal outcome code for "no program was available"; never translated on the
# wire (the frontend owns the display string).
UNMATCHED_OUTCOME = "Unmatched"


# ---------------------------------------------------------------------------
# Language
# ---------------------------------------------------------------------------

def _t(key: str, lang: str, **params) -> str:
    """Translate ``key`` into ``lang``.

    The ``except TypeError`` fallback keeps this module importable against an
    older ``sae_app.i18n.t`` signature without a keyword-only ``lang``; it costs
    one TypeError and never changes the returned text for the default language.
    """
    try:
        return t(key, lang=lang, **params)
    except TypeError:
        return t(key, **params)


def _first_supported_accept_language(header_value: str) -> str | None:
    """Return the first supported tag of an Accept-Language header, or None.

    Quality values are parsed away but not ranked: the header is read in the
    order the client sent it, which is what "first supported tag" means here.
    """
    for raw_tag in str(header_value or "").split(","):
        tag = raw_tag.split(";", 1)[0].strip().lower().replace("_", "-")
        if not tag or tag == "*":
            continue
        if tag in SUPPORTED_LANGUAGES:
            return tag
        primary = tag.split("-", 1)[0]
        if primary in SUPPORTED_LANGUAGES:
            return primary
    return None


def request_language(
    lang: str | None = Query(
        None,
        description="Language for `message` fields: es (default) or en.",
    ),
    accept_language: str | None = Header(None, alias="Accept-Language"),
) -> str:
    """Resolve the language of this request's ``message`` fields."""
    if lang:
        code = str(lang).strip().lower().replace("_", "-")
        if code in SUPPORTED_LANGUAGES:
            return code
        primary = code.split("-", 1)[0]
        if primary in SUPPORTED_LANGUAGES:
            return primary
        return DEFAULT_LANGUAGE
    if accept_language:
        return _first_supported_accept_language(accept_language) or DEFAULT_LANGUAGE
    return DEFAULT_LANGUAGE


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

def _error_detail(error_key: str, message: str, params: dict | None = None) -> dict:
    return {"error_key": error_key, "message": message, "params": params or {}}


def _api_error(
    error_key: str,
    message_key: str,
    lang: str,
    *,
    status_code: int = 422,
    **params,
) -> HTTPException:
    """Build an HTTPException whose body is the bare v1 error envelope."""
    return HTTPException(
        status_code=status_code,
        detail=_error_detail(error_key, _t(message_key, lang, **params), params),
    )


def _engine_error(exc: MtbEngineError, lang: str) -> HTTPException:
    """Translate a typed engine error at the presentation boundary."""
    return HTTPException(
        status_code=422,
        detail=_error_detail(
            exc.message_key,
            _t(exc.message_key, lang, **exc.message_kwargs),
            exc.message_kwargs,
        ),
    )


def _validation_failure(headline: str, problems: list[str]) -> RuntimeError:
    """Build a RuntimeError listing the first few problems, then the count."""
    shown = problems[:MAX_REPORTED_VALIDATION_PROBLEMS]
    remaining = len(problems) - len(shown)
    lines = [headline, *(f"  - {problem}" for problem in shown)]
    if remaining > 0:
        lines.append(f"  ... and {remaining} more problem(s).")
    return RuntimeError("\n".join(lines))


def validate_calibration(calib: pd.DataFrame) -> None:
    """Run the three data-integrity checks at startup and fail hard.

    A headless API has no surface to show problems on, so an invalid dataset
    must stop uvicorn from starting rather than let it serve probabilities
    computed from bad data.
    """
    missing = [column for column in required_cols() if column not in calib.columns]
    if missing:
        raise _validation_failure(
            "Calibration data is missing required column(s).", missing
        )

    numeric_errors = validate_core_numeric_columns(calib)
    if numeric_errors:
        raise _validation_failure(
            "Calibration numeric columns contain invalid values. "
            "Check the calibration CSV before starting the API.",
            numeric_errors,
        )

    cumulative_share_errors = validate_cumulative_share_columns(calib)
    if cumulative_share_errors:
        raise _validation_failure(
            "Calibration cumulative-share columns are inconsistent or incomplete. "
            "Check the calibration CSV before starting the API.",
            cumulative_share_errors,
        )


def _data_fingerprint(*file_bytes: bytes) -> str:
    """Short digest identifying the exact dataset this process is serving.

    The frontend caches /meta and program lists; when the CSVs change, this
    value changes and the caller knows its cached labels may be stale.
    """
    digest = hashlib.sha256()
    for chunk in file_bytes:
        digest.update(hashlib.sha256(chunk).digest())
    return digest.hexdigest()[:16]


@asynccontextmanager
async def lifespan(app: FastAPI):
    capacities_bytes = CAPACITIES_PATH.read_bytes()
    calib = load_calibration(capacities_bytes)
    validate_calibration(calib)
    program_mapping = build_program_mapping(calib)

    id_to_label: dict[str, str] = {}
    label_to_id: dict[str, str] = {}
    for label, row in program_mapping.items():
        program_id = f"{row['rbd']}:{row['program_code']}"
        id_to_label[program_id] = label
        label_to_id[label] = program_id

    STATE["calib"] = calib
    STATE["program_mapping"] = program_mapping
    STATE["id_to_label"] = id_to_label
    STATE["label_to_id"] = label_to_id
    STATE["regions"] = available_regions(calib)
    STATE["data_fingerprint"] = _data_fingerprint(
        capacities_bytes,
        RBD_REGION_PATH.read_bytes(),
        PROGRAM_FILTERS_PATH.read_bytes(),
        PROGRAM_NAMES_PATH.read_bytes(),
    )
    yield
    STATE.clear()
    _GEOCODE_RATE_LIMITER.reset()


# Routes are declared on this router and mounted by ``create_app`` at the very
# bottom of the module. The indirection exists so the app can be built more
# than once in one process — a CORS test needs a second app with a different
# environment, and reloading this module would swap STATE under the running one.
router = APIRouter()


def cors_origins(raw: str | None = None) -> list[str]:
    """Parse SAE_CORS_ORIGINS (comma-separated) into an allow-list.

    Empty by default, and an empty list means *no CORS middleware at all*: in
    the recommended deployment the browser only ever calls the Next.js proxy, so
    every request to this service is same-origin or server-to-server and no CORS
    header should be minted. Set the variable only when a frontend
    on another origin must reach this service directly, and then to that exact
    origin — never ``*``, which would let any page on the internet read a
    family's simulation from their browser.

    ``raw`` overrides the environment and exists for tests.
    """
    value = os.environ.get("SAE_CORS_ORIGINS") if raw is None else raw
    return [origin.strip() for origin in (value or "").split(",") if origin.strip()]


async def envelope_http_exception_handler(request: Request, exc: HTTPException):
    """Serve the v1 error envelope as the bare response body.

    FastAPI's default handler wraps every ``detail`` under ``{"detail": ...}``.
    The contract says a 4xx body *is* ``{error_key, message, params}``, so an
    envelope detail is emitted as-is and everything else keeps the default.
    """
    detail = exc.detail
    if isinstance(detail, dict) and "error_key" in detail and "message" in detail:
        return JSONResponse(
            status_code=exc.status_code,
            content=jsonable_encoder(detail),
            headers=getattr(exc, "headers", None),
        )
    return await default_http_exception_handler(request, exc)


async def envelope_validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
):
    """Report request-shape failures in the same envelope as engine errors."""
    lang = request_language(
        request.query_params.get("lang"),
        request.headers.get("accept-language"),
    )
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(
            _error_detail(
                "validation_error",
                _t("The request could not be read. Check the submitted fields.", lang),
                # Project each pydantic error down to its shape only. The raw
                # `input` (and `ctx`) would echo the request body — including
                # the student's RUN/IPE — back through the proxy into browser
                # consoles and error reporters.
                {"errors": [
                    {k: e[k] for k in ("type", "loc", "msg") if k in e}
                    for e in exc.errors()
                ]},
            )
        ),
    )


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

class _FixedWindowRateLimiter:
    """Smallest possible per-key sliding-window limiter, no dependency.

    In-process and per-worker on purpose: /geocode is the only endpoint that
    reaches a third-party service, and the Nominatim throttle it sits in front
    of is per-process too.
    """

    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self._max_requests = max_requests
        self._window_seconds = window_seconds
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, *, now: float | None = None) -> bool:
        """Record a hit for ``key`` and return whether it stays inside budget."""
        moment = time.monotonic() if now is None else now
        cutoff = moment - self._window_seconds
        with self._lock:
            recent = [hit for hit in self._hits.get(key, ()) if hit > cutoff]
            if len(recent) >= self._max_requests:
                self._hits[key] = recent
                return False
            recent.append(moment)
            self._hits[key] = recent
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


_GEOCODE_RATE_LIMITER = _FixedWindowRateLimiter(
    GEOCODE_RATE_LIMIT_REQUESTS,
    GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
)


def _parse_trusted_proxies(raw: str | None) -> frozenset[str]:
    """Parse SAE_TRUSTED_PROXIES into a set of hosts, falling back to loopback."""
    value = (raw or "").strip()
    if not value:
        value = DEFAULT_TRUSTED_PROXIES
    return frozenset(
        host.strip().lower() for host in value.split(",") if host.strip()
    )


TRUSTED_PROXY_HOSTS = _parse_trusted_proxies(os.environ.get("SAE_TRUSTED_PROXIES"))


def _forwarded_for_entries(request: Request) -> list[str]:
    """Every X-Forwarded-For value, left to right, across repeated headers.

    RFC 7239 makes repeated headers equivalent to one comma-joined header, and
    Starlette's ``headers.get`` would only return the first of them.
    """
    entries: list[str] = []
    for header_value in request.headers.getlist("x-forwarded-for"):
        entries.extend(part.strip() for part in header_value.split(","))
    return [entry for entry in entries if entry]


def _client_key(request: Request) -> str:
    """Rate-limit bucket for ``request``: the caller as the nearest hop saw it.

    Behind the Next.js proxy ``request.client.host`` is always the proxy, so one
    family would spend the whole per-IP budget for everyone. When the immediate
    peer is a trusted proxy we therefore use the *rightmost* X-Forwarded-For
    entry — the one that proxy appended, i.e. the address it observed — instead
    of the leftmost, which is whatever the client itself claimed and is trivial
    to spoof. From an untrusted peer the header is ignored outright.

    Uvicorn's own ProxyHeadersMiddleware (on by default, trusting 127.0.0.1)
    may already have rewritten ``request.client`` from the same header. The two
    agree: when it fires, ``host`` is no longer loopback and is used directly;
    when it does not — a proxy on another host, or ``--no-proxy-headers`` —
    this function is what keeps the bucket per browser.
    """
    client = request.client
    host = client.host if client and client.host else ""
    if host and host.lower() in TRUSTED_PROXY_HOSTS:
        entries = _forwarded_for_entries(request)
        if entries:
            return entries[-1]
    return host or "unknown"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Thresholds(BaseModel):
    hard: float
    soft: float


class FilterOptions(BaseModel):
    tracks: list[str]
    specialty_sectors: list[str]
    genders: list[str]
    school_days: list[str]
    rurality: list[str]
    pie: list[str]
    pace: list[str]
    enrollment_fee: list[str]
    monthly_fee: list[str]
    religious_orientation: list[str]


class MetaResponse(BaseModel):
    api_version: str
    data_fingerprint: str
    hard_unmatched_threshold: float
    soft_unmatched_threshold: float
    equiv_probability_change_warning_threshold: float
    max_exact_equiv_permutations: int
    recommendation_max_home_distance_km: float
    max_wishes: int
    regions: list[str]
    filter_options: FilterOptions


class ProgramSummary(BaseModel):
    program_id: str
    program_label: str
    school_name: str
    school_commune: str
    region: str
    program_display_name: str
    program_track: str
    program_specialty_sector: str
    program_gender: str
    program_school_day: str
    program_rurality: str
    program_pie: str
    program_pace: str
    program_enrollment_fee: str
    program_monthly_fee: str
    program_religious_orientation: str
    capacity: int
    true_applicants_last_year: int
    calibration_imputed: bool


class ProgramListResponse(BaseModel):
    items: list[ProgramSummary]
    total_matched: int
    truncated: bool
    offset: int
    limit: int


class WishItem(BaseModel):
    program_id: str
    equivalence_group: int | None = Field(
        default=None,
        description=(
            "Wishes sharing the same group are treated as tied; lower numbers "
            "are preferred over higher ones. Omit for strict ranking, where "
            "each wish defaults to its own group equal to its position in the "
            "list."
        ),
    )
    priority_sibling: bool = False
    priority_student: bool = False
    priority_parent_civil_servant: bool = False
    priority_ex_student: bool = False
    priority_already_registered: bool = False


class SimulationRequest(BaseModel):
    student_id: str = Field(..., description="Student RUN/IPE, e.g. 12.345.678-9")
    wishes: list[WishItem] = Field(..., min_length=1, max_length=MAX_WISHES)


class WishResult(BaseModel):
    wish_rank: int
    program_id: str
    program_label: str
    lottery_number: int
    priority_tier: str
    lottery_population_used: int
    capacity: int
    true_applicants_last_year: int
    calibration_imputed: bool
    availability_probability: float
    cumulative_unavailable_before_choice: float
    choice_assignment_probability: float


class EstimatedOutcome(BaseModel):
    program_id: str | None
    label: str
    probability: float


class SimulationVariant(BaseModel):
    order_index: int
    program_order: list[str]
    tied_order: list[list[str]]
    predicted_outcome: str
    predicted_outcome_program_id: str | None
    predicted_outcome_final_chance: float | None
    unmatched_risk: float
    at_risk: bool


class EquivalenceSensitivity(BaseModel):
    total_orders: int
    distinct_outcome_count: int
    outcome_stable: bool
    verdict: str
    predicted_chance_min: float | None
    predicted_chance_max: float | None
    variants: list[SimulationVariant]


class SimulationResponse(BaseModel):
    unmatched_risk: float
    at_risk: bool
    attention_level: str
    thresholds: Thresholds
    predicted_outcome: str
    predicted_outcome_program_id: str | None
    outcomes: list[EstimatedOutcome]
    wishes: list[WishResult]
    equivalence_sensitivity: EquivalenceSensitivity | None = None


class HomeLocation(BaseModel):
    lat: float
    lon: float
    precision: str = "approximate"


class RecommendationRequest(BaseModel):
    student_id: str = Field(..., description="Student RUN/IPE, e.g. 12.345.678-9")
    wishes: list[WishItem] = Field(..., min_length=1, max_length=MAX_WISHES)
    max_recommendations: int = Field(default=5, ge=2, le=10)
    home: HomeLocation | None = None


class RecommendationItem(BaseModel):
    program_id: str | None
    program_label: str
    school_name: str
    school_commune: str
    region: str
    program_display_name: str
    distance_km: float | None
    chance_if_considered: float
    # The candidate's final assignment probability when appended at the end of
    # the current list, i.e. at wish rank `appended_wish_rank`. See
    # `_final_chance_if_appended`: it is the marginal unmatched-risk reduction
    # the engine already computes, restated. On the wire so `web/` never
    # combines two probabilities of its own.
    final_chance_if_appended: float | None
    projected_unmatched_risk: float | None
    risk_level: str
    capacity: float | None
    applicants_per_seat: float | None
    estimated_mtb_rank: int | None
    score: float


class RecommendationDiagnostics(BaseModel):
    failed_candidates: int
    failed_candidate_examples: list[list[str]]


class RecommendationResponse(BaseModel):
    current_unmatched_risk: float
    # The wish rank every `final_chance_if_appended` assumes: one past the end
    # of the list that was sent. Returned rather than inferred so the caller
    # does not have to restate the "appended last" rule.
    appended_wish_rank: int
    distance_reference: str
    hard_distance_filter_applied: bool
    similarity_fallback_mode: bool
    items: list[RecommendationItem]
    diagnostics: RecommendationDiagnostics


class GeocodeRequest(BaseModel):
    address: str


class GeocodeResponse(BaseModel):
    ok: bool
    address: str
    lat: float | None
    lon: float | None
    precision: str | None
    display_name: str | None
    warning_key: str | None
    error_key: str | None
    params: dict
    message: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _text(row: pd.Series, column: str) -> str:
    value = row.get(column, "")
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return ""
    return str(value).strip()


def _optional_float(value) -> float | None:
    """Return a JSON-safe float, or None for blanks and non-finite values."""
    if value is None or value == "":
        return None
    try:
        as_float = float(value)
    except (TypeError, ValueError):
        return None
    return as_float if np.isfinite(as_float) else None


def _final_chance_if_appended(current_unmatched_risk: float, projected) -> float | None:
    """The candidate's own final assignment probability, appended last.

    `sae_app.recommendations.candidate_portfolio_metrics` states the identity:
    a candidate appended after the current list is reached only when every
    current wish falls through, so

        final_chance_if_appended = current_unmatched_risk * chance_if_considered
                                 = current_unmatched_risk - projected_unmatched_risk

    The engine keeps only the projected risk in the row, so the adapter restates
    it from the second form rather than re-deriving the product — the value it
    subtracts is the engine's own, already clipped to [0, 1]. Doing it here
    keeps every probability the browser prints out of the browser's arithmetic
 without adding a column to the recommendation frame, whose
    exact key set the golden fixtures pin.
    """
    projected_value = _optional_float(projected)
    if projected_value is None or not np.isfinite(current_unmatched_risk):
        return None
    return float(np.clip(current_unmatched_risk - projected_value, 0.0, 1.0))


def _optional_int(value) -> int | None:
    as_float = _optional_float(value)
    return None if as_float is None else int(round(as_float))


def _program_summary(label: str, row: pd.Series) -> ProgramSummary:
    return ProgramSummary(
        program_id=STATE["label_to_id"][label],
        program_label=label,
        school_name=_text(row, SCHOOL_NAME),
        school_commune=_text(row, SCHOOL_COMMUNE),
        region=_text(row, REGION),
        program_display_name=_text(row, PROGRAM_DISPLAY_NAME),
        program_track=_text(row, PROGRAM_TRACK),
        program_specialty_sector=_text(row, PROGRAM_SPECIALTY_SECTOR),
        program_gender=_text(row, PROGRAM_GENDER),
        program_school_day=_text(row, PROGRAM_SCHOOL_DAY),
        program_rurality=_text(row, PROGRAM_RURALITY),
        program_pie=_text(row, PROGRAM_PIE),
        program_pace=_text(row, PROGRAM_PACE),
        program_enrollment_fee=_text(row, PROGRAM_ENROLLMENT_FEE),
        program_monthly_fee=_text(row, PROGRAM_MONTHLY_FEE),
        program_religious_orientation=_text(row, PROGRAM_RELIGIOUS_ORIENTATION),
        capacity=int(_optional_float(row.get(CAPACITY)) or 0),
        true_applicants_last_year=int(_optional_float(row.get(TRUE_APP)) or 0),
        calibration_imputed=as_bool(row.get(IMPUTED, False)),
    )


def _attention_level(unmatched_risk: float) -> str:
    """Three-level presentation severity, identical to render_single_summary."""
    if unmatched_risk >= HARD_UNMATCHED_THRESHOLD:
        return "high"
    if SOFT_UNMATCHED_THRESHOLD <= unmatched_risk < HARD_UNMATCHED_THRESHOLD:
        return "moderate"
    return "low"


def _ordered_outcomes(choices: pd.DataFrame) -> list[EstimatedOutcome]:
    """The estimated outcomes, structured for the wire.

    Only programs with a strictly positive assignment probability,
    "Unmatched" always present, sorted by probability descending. Labels stay
    the internal English/join-key values; the frontend renders them.
    """
    label_to_id = STATE["label_to_id"]
    unmatched_risk = float(choices["cumulative_unavailable_after_choice"].iloc[-1])
    outcomes = [
        EstimatedOutcome(
            program_id=label_to_id.get(str(row[PROGRAM]).strip()),
            label=str(row[PROGRAM]).strip(),
            probability=float(row["choice_assignment_probability"]),
        )
        for _, row in choices.iterrows()
        if float(row["choice_assignment_probability"]) > 0
    ]
    outcomes.append(
        EstimatedOutcome(
            program_id=None,
            label=UNMATCHED_OUTCOME,
            probability=unmatched_risk,
        )
    )
    return sorted(outcomes, key=lambda item: item.probability, reverse=True)


def _tied_order(strict_order: pd.DataFrame) -> list[list[str]]:
    """Structured replacement for wish_list.compact_tied_order_label.

    Only genuinely tied groups (more than one member) are reported, in group
    order, each holding this variant's internal order as program ids. Programs
    whose position is fixed across every compatible order are omitted, exactly
    as the compact label omits them.
    """
    label_to_id = STATE["label_to_id"]
    if strict_order.empty or EQUIV_GROUP not in strict_order.columns:
        return []

    groups: list[list[str]] = []
    for _, group in strict_order.groupby(EQUIV_GROUP, sort=True):
        if len(group) <= 1:
            continue
        program_ids = [
            label_to_id[label]
            for label in group[PROGRAM].astype(str).str.strip().tolist()
            if label and label in label_to_id
        ]
        if program_ids:
            groups.append(program_ids)
    return groups


def _equivalence_verdict(
    distinct_outcome_count: int,
    predicted_chance_min: float | None,
    predicted_chance_max: float | None,
) -> str:
    """Classify the equivalence-order sensitivity into one of three verdicts."""
    predicted_chance_range = (
        predicted_chance_max - predicted_chance_min
        if predicted_chance_min is not None and predicted_chance_max is not None
        else 0.0
    )
    if distinct_outcome_count != 1:
        return "outcome_changes"
    if predicted_chance_range >= EQUIV_PROBABILITY_CHANGE_WARNING_THRESHOLD:
        return "stable_probability_shift"
    return "stable"


def _wishes_dataframe(wishes: list[WishItem], lang: str) -> pd.DataFrame:
    """Turn wire wishes into the DataFrame the engine expects.

    Duplicate and unknown program ids are rejected here so no half-built list
    ever reaches the engine.
    """
    id_to_label = STATE["id_to_label"]

    rows = []
    seen_program_ids: set[str] = set()
    for rank, wish in enumerate(wishes, start=1):
        if wish.program_id in seen_program_ids:
            raise _api_error(
                "duplicate_program_id",
                "The program {program_id} appears more than once in the list.",
                lang,
                program_id=wish.program_id,
            )
        seen_program_ids.add(wish.program_id)

        label = id_to_label.get(wish.program_id)
        if label is None:
            raise _api_error(
                "unknown_program_id",
                "Unknown program identifier: {program_id}.",
                lang,
                program_id=wish.program_id,
            )
        rows.append({
            WISH_RANK: rank,
            EQUIV_GROUP: wish.equivalence_group if wish.equivalence_group is not None else rank,
            PROGRAM: label,
            LOTTERY: 1,
            "priority_sibling": wish.priority_sibling,
            "priority_student": wish.priority_student,
            "priority_parent_civil_servant": wish.priority_parent_civil_servant,
            "priority_ex_student": wish.priority_ex_student,
            SAFETY: wish.priority_already_registered,
        })

    return pd.DataFrame(
        rows, columns=[WISH_RANK, EQUIV_GROUP, PROGRAM, LOTTERY] + PRIORITIES + [SAFETY]
    )


def _reference_order(wishes_df: pd.DataFrame, lang: str) -> pd.DataFrame:
    """Reference strict order, with the two guards /simulate and /recommend share."""
    reference_order = prepare_ordered_wishes(wishes_df, use_equivalence_classes=True)
    if reference_order.empty:
        raise _api_error("empty_wish_list", "Add at least one valid wish.", lang)

    total_orders = count_equivalence_orders(reference_order)
    if total_orders > MAX_EXACT_EQUIV_PERMUTATIONS:
        raise _api_error(
            "too_many_equivalence_orders",
            "The equivalence classes generate {n:,} strict orders. This is above "
            "the exact-evaluation limit of {limit:,}. Split large equivalence "
            "groups into smaller groups, then run the simulation again.",
            lang,
            n=total_orders,
            limit=MAX_EXACT_EQUIV_PERMUTATIONS,
        )
    return reference_order


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/meta", response_model=MetaResponse)
def get_meta() -> MetaResponse:
    """Everything the frontend would otherwise hard-code."""
    return MetaResponse(
        api_version=API_VERSION,
        data_fingerprint=STATE["data_fingerprint"],
        hard_unmatched_threshold=HARD_UNMATCHED_THRESHOLD,
        soft_unmatched_threshold=SOFT_UNMATCHED_THRESHOLD,
        equiv_probability_change_warning_threshold=EQUIV_PROBABILITY_CHANGE_WARNING_THRESHOLD,
        max_exact_equiv_permutations=MAX_EXACT_EQUIV_PERMUTATIONS,
        recommendation_max_home_distance_km=float(RECOMMENDATION_MAX_HOME_DISTANCE_KM),
        max_wishes=MAX_WISHES,
        regions=list(STATE["regions"]),
        filter_options=FilterOptions(
            tracks=[TRACK_GENERAL, TRACK_SPECIALIZED],
            specialty_sectors=list(SPECIALTY_FILTER_OPTIONS),
            genders=list(GENDER_FILTER_OPTIONS),
            school_days=list(SCHOOL_DAY_FILTER_OPTIONS),
            rurality=list(RURALITY_FILTER_OPTIONS),
            pie=list(PIE_FILTER_OPTIONS),
            pace=list(PACE_FILTER_OPTIONS),
            enrollment_fee=list(PAYMENT_FILTER_OPTIONS),
            monthly_fee=list(PAYMENT_FILTER_OPTIONS),
            religious_orientation=list(RELIGIOUS_FILTER_OPTIONS),
        ),
    )


@router.get("/regions", response_model=list[str])
def get_regions() -> list[str]:
    """Superseded by /meta.regions; kept for compatibility."""
    return list(STATE["regions"])


@router.get("/programs", response_model=ProgramListResponse)
def get_programs(
    region: str | None = Query(None, description="Exact region name, as returned by /regions"),
    q: str | None = Query(None, description="Free-text search over school name, commune, and program name"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    track: list[str] | None = Query(None),
    specialty_sector: list[str] | None = Query(None),
    gender: list[str] | None = Query(None),
    school_day: list[str] | None = Query(None),
    rurality: list[str] | None = Query(None),
    pie: list[str] | None = Query(None),
    pace: list[str] | None = Query(None),
    enrollment_fee: list[str] | None = Query(None),
    monthly_fee: list[str] | None = Query(None),
    religious_orientation: list[str] | None = Query(None),
) -> ProgramListResponse:
    """Programs in mapping order (region, rbd, program code), filtered and paged.

    Filter semantics are ``data_loading.program_matches_filters``, so the API
    and the web filter panel can never drift apart.
    """
    program_mapping = STATE["program_mapping"]
    needle = q.strip().lower() if q else None

    # Same dict shape program_matches_filters reads; the query parameters are
    # singular because that is how a repeated query string reads in a URL.
    active_filters = {
        "tracks": track,
        "specialty_sectors": specialty_sector,
        "genders": gender,
        "school_days": school_day,
        "rurality": rurality,
        "pie": pie,
        "pace": pace,
        "enrollment_fee": enrollment_fee,
        "monthly_fee": monthly_fee,
        "religious_orientation": religious_orientation,
    }

    items: list[ProgramSummary] = []
    total_matched = 0
    for label, row in program_mapping.items():
        if region and _text(row, REGION) != region:
            continue
        if not program_matches_filters(row, active_filters):
            continue

        if needle:
            haystack = " ".join([
                _text(row, SCHOOL_NAME),
                _text(row, SCHOOL_COMMUNE),
                _text(row, PROGRAM_DISPLAY_NAME),
            ]).lower()
            if needle not in haystack:
                continue

        # Count every match, not just the ones kept, so the caller can page
        # and can tell whether `limit` cut off real results.
        matched_index = total_matched
        total_matched += 1
        if matched_index < offset or len(items) >= limit:
            continue
        items.append(_program_summary(label, row))

    return ProgramListResponse(
        items=items,
        total_matched=total_matched,
        truncated=total_matched > offset + len(items),
        offset=offset,
        limit=limit,
    )


@router.get("/programs/{program_id}", response_model=ProgramSummary)
def get_program(
    program_id: str,
    lang: str = Depends(request_language),
) -> ProgramSummary:
    label = STATE["id_to_label"].get(program_id)
    if label is None:
        raise _api_error(
            "unknown_program_id",
            "Unknown program identifier: {program_id}.",
            lang,
            status_code=404,
            program_id=program_id,
        )
    return _program_summary(label, STATE["program_mapping"][label])


@router.post("/simulate", response_model=SimulationResponse)
def simulate(
    payload: SimulationRequest,
    lang: str = Depends(request_language),
) -> SimulationResponse:
    try:
        normalize_student_identifier(payload.student_id)
    except MtbEngineError as exc:
        raise _engine_error(exc, lang) from exc

    program_mapping = STATE["program_mapping"]
    label_to_id = STATE["label_to_id"]

    wishes_df = _wishes_dataframe(payload.wishes, lang)
    reference_order = _reference_order(wishes_df, lang)
    total_orders = count_equivalence_orders(reference_order)

    try:
        availability_lookup = precompute_equivalence_availability(
            reference_order, program_mapping, payload.student_id
        )

        variants: list[SimulationVariant] = []
        reference_choices = None
        reference_outcome = reference_p_unmatched = reference_at_risk = None

        for idx, strict_order in enumerate(iter_equivalence_orders(reference_order), start=1):
            choices = compute_equivalence_order_from_precomputed(strict_order, availability_lookup)
            outcome, p_unmatched, at_risk = predicted_outcome_from_choices(choices, HARD_UNMATCHED_THRESHOLD)

            if idx == 1:
                reference_choices = choices
                reference_outcome, reference_p_unmatched, reference_at_risk = outcome, p_unmatched, at_risk

            variants.append(SimulationVariant(
                order_index=idx,
                program_order=[label_to_id.get(str(p).strip(), "") for p in strict_order[PROGRAM]],
                tied_order=_tied_order(strict_order),
                predicted_outcome=outcome,
                predicted_outcome_program_id=label_to_id.get(outcome),
                predicted_outcome_final_chance=_optional_float(
                    predicted_outcome_final_chance(choices, outcome)
                ),
                unmatched_risk=p_unmatched,
                at_risk=at_risk,
            ))
    except MtbEngineError as exc:
        raise _engine_error(exc, lang) from exc

    equivalence_sensitivity = None
    if total_orders > 1:
        distinct_outcomes = {variant.predicted_outcome for variant in variants}
        predicted_chances = [
            variant.predicted_outcome_final_chance
            for variant in variants
            if variant.predicted_outcome_final_chance is not None
        ]
        predicted_chance_min = min(predicted_chances) if predicted_chances else None
        predicted_chance_max = max(predicted_chances) if predicted_chances else None
        equivalence_sensitivity = EquivalenceSensitivity(
            total_orders=total_orders,
            distinct_outcome_count=len(distinct_outcomes),
            outcome_stable=len(distinct_outcomes) == 1,
            verdict=_equivalence_verdict(
                len(distinct_outcomes),
                predicted_chance_min,
                predicted_chance_max,
            ),
            predicted_chance_min=predicted_chance_min,
            predicted_chance_max=predicted_chance_max,
            variants=variants,
        )

    return SimulationResponse(
        unmatched_risk=reference_p_unmatched,
        at_risk=reference_at_risk,
        attention_level=_attention_level(reference_p_unmatched),
        thresholds=Thresholds(
            hard=HARD_UNMATCHED_THRESHOLD,
            soft=SOFT_UNMATCHED_THRESHOLD,
        ),
        predicted_outcome=reference_outcome,
        predicted_outcome_program_id=label_to_id.get(reference_outcome),
        outcomes=_ordered_outcomes(reference_choices),
        wishes=[
            WishResult(
                wish_rank=int(row[WISH_RANK]),
                program_id=label_to_id.get(str(row[PROGRAM]).strip(), ""),
                program_label=str(row[PROGRAM]).strip(),
                lottery_number=int(row["lottery_number"]),
                priority_tier=str(row["priority_tier"]),
                lottery_population_used=int(row["lottery_population_used"]),
                capacity=int(row["capacity"]),
                true_applicants_last_year=int(row["true_applicants_last_year"]),
                calibration_imputed=bool(row["calibration_2024_imputed"]),
                availability_probability=float(row["availability_probability"]),
                cumulative_unavailable_before_choice=float(
                    row["cumulative_unavailable_before_choice"]
                ),
                choice_assignment_probability=float(row["choice_assignment_probability"]),
            )
            for _, row in reference_choices.iterrows()
        ],
        equivalence_sensitivity=equivalence_sensitivity,
    )


def _school_name(value: object, lang: str) -> str:
    """Translate the engine's missing-school-name code, pass real names through.

    ``sae_app.recommendations`` is language-free: it
    emits ``SCHOOL_NAME_UNAVAILABLE`` as a code and the presentation layer —
    here, the request language — turns it into copy. School names themselves
    are shown verbatim.
    """
    text = str(value).strip()
    if text == SCHOOL_NAME_UNAVAILABLE:
        return _t(SCHOOL_NAME_UNAVAILABLE, lang)
    return text


@router.post("/recommend", response_model=RecommendationResponse)
def recommend(
    payload: RecommendationRequest,
    lang: str = Depends(request_language),
) -> RecommendationResponse:
    """Suggest acceptable programs to append.

    The current unmatched risk is recomputed server-side from the submitted
    list; a client-supplied risk would let the frontend steer the ranking.
    """
    try:
        normalize_student_identifier(payload.student_id)
    except MtbEngineError as exc:
        raise _engine_error(exc, lang) from exc

    program_mapping = STATE["program_mapping"]
    label_to_id = STATE["label_to_id"]

    wishes_df = _wishes_dataframe(payload.wishes, lang)
    reference_order = _reference_order(wishes_df, lang)

    try:
        availability_lookup = precompute_equivalence_availability(
            reference_order, program_mapping, payload.student_id
        )
        first_order = next(iter_equivalence_orders(reference_order))
        reference_choices = compute_equivalence_order_from_precomputed(
            first_order, availability_lookup
        )
        current_unmatched_risk = float(
            reference_choices["cumulative_unavailable_after_choice"].iloc[-1]
        )
    except MtbEngineError as exc:
        raise _engine_error(exc, lang) from exc

    home_geo_reference = payload.home.model_dump() if payload.home else None

    # Recommendation behavior is intentionally not client-configurable; these
    # are the frozen recommendation constants, in the order the engine expects.
    competition_weight = (
        RECOMMENDATION_COMPETITION_WEIGHT if RECOMMENDATION_FAVOR_LESS_OVERSUBSCRIBED else 0.0
    )
    diversity_strength = RECOMMENDATION_DIVERSITY_STRENGTH if RECOMMENDATION_DIVERSIFY else 0.0

    try:
        recommendations, _profile_table = recommend_similar_programs(
            wishes_df,
            program_mapping,
            student_id=payload.student_id,
            current_unmatched_risk=current_unmatched_risk,
            max_recommendations=payload.max_recommendations,
            rank_sensitive=True,
            competition_weight=competition_weight,
            hard_constraint_cols=RECOMMENDATION_HARD_CONSTRAINT_COLS,
            proximity_weight=RECOMMENDATION_PROXIMITY_WEIGHT,
            distance_scale_km=float(RECOMMENDATION_DISTANCE_SCALE_KM),
            home_geo_reference=home_geo_reference,
            max_home_distance_km=(
                RECOMMENDATION_MAX_HOME_DISTANCE_KM if home_geo_reference else None
            ),
            risk_optimization_weight=RECOMMENDATION_RISK_OPTIMIZATION_WEIGHT,
            min_similarity_score=RECOMMENDATION_MIN_SIMILARITY_SCORE,
            diversify=RECOMMENDATION_DIVERSIFY,
            diversity_strength=diversity_strength,
        )
    except MtbEngineError as exc:
        raise _engine_error(exc, lang) from exc
    except CandidateEvaluationError as exc:
        raise _api_error(
            "invalid_program_data",
            "Recommendations could not be computed because some program data are invalid.",
            lang,
        ) from exc

    distance_reference = "home" if home_geo_reference else "list"
    distance_column = (
        "Straight-line distance from home (km)"
        if home_geo_reference
        else "Straight-line distance from current list (km)"
    )

    diagnostics_raw = dict(recommendations.attrs.get("recommendation_diagnostics", {}))
    diagnostics = RecommendationDiagnostics(
        failed_candidates=int(diagnostics_raw.get("failed_candidates", 0) or 0),
        failed_candidate_examples=[
            [str(part) for part in example]
            for example in diagnostics_raw.get("failed_candidate_examples", ())
        ],
    )

    items: list[RecommendationItem] = []
    similarity_fallback_mode = False
    for _, row in recommendations.iterrows():
        program_label = str(row.get(PROGRAM, "")).strip()
        similarity_fallback_mode = similarity_fallback_mode or bool(
            row.get("_similarity_fallback_mode", False)
        )
        items.append(RecommendationItem(
            program_id=label_to_id.get(program_label),
            program_label=program_label,
            school_name=_school_name(row.get("School", ""), lang),
            school_commune=str(row.get("Commune", "")).strip(),
            region=str(row.get("Region", "")).strip(),
            program_display_name=str(row.get("Program details", "")).strip(),
            distance_km=_optional_float(row.get(distance_column)),
            # Raw columns only: the formatted "Chance if considered" etc. are
            # display strings and must never reach the wire.
            chance_if_considered=float(row.get("_chance_if_considered_raw", 0.0)),
            final_chance_if_appended=_final_chance_if_appended(
                current_unmatched_risk, row.get("_projected_unmatched_risk_raw")
            ),
            projected_unmatched_risk=_optional_float(row.get("_projected_unmatched_risk_raw")),
            risk_level=str(row.get("_risk_color", "gray")).strip() or "gray",
            capacity=_optional_float(row.get("Capacity")),
            applicants_per_seat=_optional_float(row.get("Applicants / seat")),
            estimated_mtb_rank=_optional_int(row.get("Estimated MTB rank")),
            score=float(row.get("_recommendation_score_raw", 0.0)),
        ))

    return RecommendationResponse(
        current_unmatched_risk=current_unmatched_risk,
        appended_wish_rank=len(payload.wishes) + 1,
        distance_reference=distance_reference,
        hard_distance_filter_applied=bool(
            home_geo_reference is not None
            and home_geocoding_supports_hard_filter(home_geo_reference)
        ),
        similarity_fallback_mode=similarity_fallback_mode,
        items=items,
        diagnostics=diagnostics,
    )


@router.post("/geocode", response_model=GeocodeResponse)
def geocode(
    payload: GeocodeRequest,
    request: Request,
    lang: str = Depends(request_language),
) -> GeocodeResponse:
    """Resolve a family-entered address, behind a per-IP budget.

    The address is never stored; only the coordinates travel back. Nominatim's
    1 req/s policy is enforced inside geo.py for the whole process, so the
    limit here exists to stop one caller from consuming that shared budget.
    """
    if not _GEOCODE_RATE_LIMITER.allow(_client_key(request)):
        raise _api_error(
            "rate_limited",
            "Too many address lookups. Wait a moment and try again.",
            lang,
            status_code=429,
            limit=GEOCODE_RATE_LIMIT_REQUESTS,
            window_seconds=int(GEOCODE_RATE_LIMIT_WINDOW_SECONDS),
        )

    result = geocode_chilean_address(payload.address)

    if not result.get("ok"):
        error_key = str(result.get("error_key", ""))
        params = dict(result.get("error_kwargs", {}))
        return GeocodeResponse(
            ok=False,
            address=str(result.get("address", payload.address)),
            lat=None,
            lon=None,
            precision=None,
            display_name=None,
            warning_key=None,
            error_key=error_key,
            params=params,
            message=_t(error_key, lang, **params) if error_key else "",
        )

    warning_key = geocoding_precision_warning_key(result)
    return GeocodeResponse(
        ok=True,
        address=str(result.get("address", payload.address)),
        lat=_optional_float(result.get("lat")),
        lon=_optional_float(result.get("lon")),
        precision=str(result.get("precision", "")),
        display_name=str(result.get("display_name", "")),
        warning_key=warning_key or None,
        error_key=None,
        params={},
        message=_t(warning_key, lang) if warning_key else "",
    )


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    """Build the ASGI app: error envelopes, optional CORS, then the routes."""
    application = FastAPI(
        title="SAE admission-risk simulation API",
        version=API_VERSION,
        lifespan=lifespan,
    )

    origins = cors_origins()
    if origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    application.add_exception_handler(
        HTTPException, envelope_http_exception_handler
    )
    application.add_exception_handler(
        RequestValidationError, envelope_validation_exception_handler
    )
    application.include_router(router)
    return application


app = create_app()
