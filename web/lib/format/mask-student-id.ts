/**
 * A RUN/IPE reduced to its last five body digits and the verifier — the only
 * form of the identifier ever shown back to the family (the finish summary).
 * Display-only; an invalid identifier returns `""` so the caller hides the line.
 */

import { checkStudentIdentifier } from "@/lib/validation/student-id";

/** Trailing body digits kept visible; a body this short or shorter is shown whole. */
const VISIBLE_BODY_DIGITS = 5;

const MASK = "…";

/** `"12.345.678-5"` → `"…45678-5"`; an invalid RUN/IPE → `""`. */
export function maskStudentId(raw: string): string {
  const check = checkStudentIdentifier(raw);
  if (!check.ok) return "";

  const [body, verifier] = check.normalized.split("-");
  if (body.length <= VISIBLE_BODY_DIGITS) return `${body}-${verifier}`;
  return `${MASK}${body.slice(-VISIBLE_BODY_DIGITS)}-${verifier}`;
}
