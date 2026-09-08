/**
 * Client-side RUN/IPE pre-check — a display-only mirror of
 * `sae_app/mtb_engine.py`, so the wizard can give inline feedback and gate
 * "Continue" without a round trip.
 *
 * THE SERVER REMAINS AUTHORITATIVE: the identifier is sent to `/simulate` and
 * `/recommend` as typed and re-validated in Python; on any disagreement the
 * engine wins. Keep this in sync with `mtb_engine.py` — `student-id.test.ts`
 * checks it against the `identifier_*` golden fixtures.
 */

export type StudentIdKind = "run" | "ipe";

/**
 * `empty` — nothing to validate yet (engine: "Enter the student RUN/IPE …")
 * `format` — neither a RUN nor an IPE shape (engine: "Invalid RUN/IPE format …")
 * `check_digit` — RUN body is fine but the modulo-11 verifier does not match
 */
export type StudentIdFailureReason = "empty" | "format" | "check_digit";

export type StudentIdCheck =
  | { ok: true; kind: StudentIdKind; normalized: string }
  | { ok: false; reason: StudentIdFailureReason };

/** Mirrors `_clean_identifier_input`: strip all whitespace, upper-case. */
function cleanIdentifierInput(studentId: string): string | null {
  const raw = String(studentId ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return raw === "" ? null : raw;
}

// A RUN is a numeric body of up to 8 digits (optionally dotted in groups of
// three) plus a check digit that may be "K". The hyphen is optional.
const RUN_PATTERN = /^(?:(\d{1,8})|(\d{1,2}(?:\.\d{3}){1,2}))-?([0-9K])$/;

// An IPE is a nine-digit body (optionally dotted) plus a numeric verifier.
const IPE_PATTERN = /^(?:(\d{9})|(\d{3}(?:\.\d{3}){2}))-?(\d)$/;

/** Mirrors `_run_check_digit`: modulo-11 with the 2..7 multiplier cycle. */
export function runCheckDigit(body: string): string {
  let total = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    total += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const result = 11 - (total % 11);
  if (result === 11) return "0";
  if (result === 10) return "K";
  return String(result);
}

/** Mirrors `normalize_run`. Returns the canonical `body-checkDigit`. */
export function checkRun(studentId: string): StudentIdCheck {
  const raw = cleanIdentifierInput(studentId);
  if (raw === null) return { ok: false, reason: "empty" };

  const match = RUN_PATTERN.exec(raw);
  if (match === null) return { ok: false, reason: "format" };

  const body = (match[1] ?? match[2] ?? "").replace(/\./g, "");
  // `int(body) == 0` in the engine — a body of only zeros is not a RUN.
  if (/^0+$/.test(body)) return { ok: false, reason: "format" };

  const checkDigit = match[3];
  if (checkDigit !== runCheckDigit(body)) {
    return { ok: false, reason: "check_digit" };
  }

  // `int(body)` drops leading zeros, exactly as the engine does.
  return {
    ok: true,
    kind: "run",
    normalized: `${String(Number(body))}-${checkDigit}`,
  };
}

/**
 * Mirrors `normalize_ipe`. The IPE verifier digit is *not* re-computed by the
 * engine, so this mirror does not invent a check-digit rule either; only the
 * shape is validated.
 */
export function checkIpe(studentId: string): StudentIdCheck {
  const raw = cleanIdentifierInput(studentId);
  if (raw === null) return { ok: false, reason: "empty" };

  const match = IPE_PATTERN.exec(raw);
  if (match === null) return { ok: false, reason: "format" };

  const body = (match[1] ?? match[2] ?? "").replace(/\./g, "");
  return { ok: true, kind: "ipe", normalized: `${body}-${match[3]}` };
}

/**
 * Mirrors `normalize_student_identifier`: a ten-digit compact value (nine-digit
 * body + verifier) is an IPE, everything else is parsed as a RUN.
 */
export function checkStudentIdentifier(studentId: string): StudentIdCheck {
  const raw = cleanIdentifierInput(studentId);
  if (raw === null) return { ok: false, reason: "empty" };

  const compact = raw.replace(/\./g, "").replace(/-/g, "");
  return compact.length === 10 ? checkIpe(raw) : checkRun(raw);
}

/** Convenience for step gates: does the pre-check pass? */
export function isValidStudentIdentifier(studentId: string): boolean {
  return checkStudentIdentifier(studentId).ok;
}
