"use client";

import { Card, CardContent } from "@/components/ui/card";
import { StepPage } from "@/components/wizard/step-page";

import { PrivacyNote } from "./privacy-note";
import { StudentIdField } from "./student-id-field";

/**
 * Step 1 — identify the student: just the identifier field with its "why do we
 * ask" popover, then the privacy statement. The disclaimer, the list-exists
 * question and the ties toggle all live elsewhere now.
 *
 * Continue is not wired here — the gate lives in the store and `WizardNav`
 * renders the button; this step only writes to the store.
 */
export function StudentStep() {
  return (
    <StepPage slug="student" lead={null}>
      <Card>
        <CardContent>
          <StudentIdField />
        </CardContent>
      </Card>

      <PrivacyNote />
    </StepPage>
  );
}
