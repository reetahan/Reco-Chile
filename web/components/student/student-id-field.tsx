"use client";

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWizardStore } from "@/lib/store/wizard";
import { cn } from "@/lib/utils";
import {
  checkStudentIdentifier,
  type StudentIdCheck,
  type StudentIdKind,
} from "@/lib/validation/student-id";

import { WhyWeAsk } from "./why-we-ask";

/**
 * Message id per non-empty failure reason. `format` covers "neither a RUN nor
 * an IPE", which is exactly what `errors.invalidStudentId` describes; a
 * well-formed RUN body with the wrong verifier gets the specific check-digit
 * message. An empty field shows no feedback line at all.
 */
const FAILURE_KEY = {
  format: "errors.invalidStudentId",
  check_digit: "errors.invalidRunCheckDigit",
} as const;

/**
 * The two accepted identifier shapes, as they are named in the confirmation
 * message. "RUN" and "IPE" are the Chilean document names, identical in both
 * catalogues, so they are interpolated rather than given `enums.*` entries.
 */
const KIND_NAME = {
  run: "RUN",
  ipe: "IPE",
} as const satisfies Record<StudentIdKind, string>;

const STUDENT_ID_INPUT_ID = "student-id";
const FEEDBACK_ID = "student-id-feedback";

type StudentIdFeedbackState = "valid" | "empty" | "invalid";

/** The `data-state` the feedback line exposes to tests and to CSS. */
function studentIdFeedbackState(check: StudentIdCheck): StudentIdFeedbackState {
  if (check.ok) return "valid";
  return check.reason === "empty" ? "empty" : "invalid";
}

/**
 * The RUN/IPE field of step 1.
 *
 * The pre-check is display-only. `@/lib/validation/student-id` mirrors
 * `normalize_student_identifier` so the feedback line and the step gate can
 * react on every keystroke without a round trip, but the engine re-validates
 * the identifier on `/simulate` and the API's 422 message is what the family
 * finally sees.
 *
 * Privacy: the value lives in the store's memory-only slice — never
 * persisted, never in the URL, never logged. `autoComplete="off"` keeps the
 * browser from filling or remembering it, and `spellCheck={false}` keeps it out
 * of the spell-checker's dictionary.
 */
export function StudentIdField() {
  const t = useTranslations();

  const studentId = useWizardStore((state) => state.studentId);
  const setStudentId = useWizardStore((state) => state.setStudentId);

  const check = checkStudentIdentifier(studentId);
  const state = studentIdFeedbackState(check);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Label htmlFor={STUDENT_ID_INPUT_ID}>{t("student.idLabel")}</Label>
        <WhyWeAsk />
      </div>
      <Input
        id={STUDENT_ID_INPUT_ID}
        name={STUDENT_ID_INPUT_ID}
        value={studentId}
        onChange={(event) => setStudentId(event.target.value)}
        placeholder={t("student.idPlaceholder")}
        // A RUN/IPE is digits plus optional dots, an optional hyphen and — for
        // a RUN — a possible "K" verifier, so the field stays `type="text"` and
        // never filters what is typed; `inputMode` only asks the on-screen
        // keyboard to open on its numeric layer, which is what all but the last
        // character needs.
        inputMode="numeric"
        autoComplete="off"
        // The engine upper-cases the input (`_clean_identifier_input`), so a
        // lower-case "k" is accepted; capitalising it just matches what the
        // placeholder and the error messages show.
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={state === "invalid" || undefined}
        aria-describedby={state === "empty" ? undefined : FEEDBACK_ID}
      />
      {/* Always in the DOM — `hidden` when empty rather than unmounted — so a
          browser extension that grafts onto the input (Grammarly, a page
          translator, a password manager) cannot desync React's reconciliation
          of this subtree. Mounting/unmounting a sibling of the field is what
          makes React's `insertBefore` throw once the extension has moved a
          node it did not create. `role="status"` implies `aria-live="polite"`;
          a hidden status region is not announced. */}
      <p
        id={FEEDBACK_ID}
        role="status"
        data-testid={FEEDBACK_ID}
        data-state={state}
        hidden={state === "empty"}
        className={cn(
          "flex items-start gap-1.5 text-sm",
          // emerald-700, not -600: #009966 on white is 3.7:1, below the 4.5:1
          // AA floor for this 14px line (axe `color-contrast`, serious).
          state === "valid" && "text-emerald-700 dark:text-emerald-400",
          state === "invalid" && "text-destructive",
        )}
      >
        {check.ok ? (
          <>
            <CircleCheckIcon
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {t("student.idValid", { kind: KIND_NAME[check.kind] })}
          </>
        ) : check.reason !== "empty" ? (
          <>
            <CircleAlertIcon
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {t(FAILURE_KEY[check.reason])}
          </>
        ) : null}
      </p>
    </div>
  );
}
