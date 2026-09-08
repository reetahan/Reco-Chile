import { describe, expect, it } from "vitest";

import en from "@/messages/en";
import es from "@/messages/es";

import {
  FINISH_PATH,
  FINISH_SLUG,
  STEP_LABEL_KEY,
  STEP_LEAD_KEY,
  STEP_SLUGS,
  STEP_TITLE_KEY,
  WELCOME_PATH,
  isFinishPathname,
  isStepSlug,
  nextSlug,
  ownsForwardChoice,
  previousSlug,
  stepFromPathname,
  stepNumber,
  stepPath,
  stepSlug,
} from "./steps";

describe("step identity", () => {
  it("orders the four steps", () => {
    expect(STEP_SLUGS).toEqual(["student", "list", "result", "improve"]);
    expect(STEP_SLUGS.map(stepNumber)).toEqual([1, 2, 3, 4]);
  });

  it("round-trips slug ↔ store step number", () => {
    for (const slug of STEP_SLUGS) {
      expect(stepSlug(stepNumber(slug))).toBe(slug);
    }
  });

  it("recognises step slugs", () => {
    expect(isStepSlug("student")).toBe(true);
    expect(isStepSlug("Student")).toBe(false);
    expect(isStepSlug("")).toBe(false);
  });

  it("keeps the welcome and completion pages out of the four steps", () => {
    // The rail still shows four steps. The welcome page opens the wizard
    // and the completion page ends it; neither is a `StepSlug`.
    expect(isStepSlug(FINISH_SLUG)).toBe(false);
    expect(STEP_SLUGS).not.toContain(FINISH_SLUG);
    expect(WELCOME_PATH).toBe("/");
    expect(FINISH_PATH).toBe("/finish");
  });
});

describe("routing", () => {
  it("builds locale-free step paths (the prefix comes from @/i18n/navigation)", () => {
    expect(stepPath("student")).toBe("/student");
    expect(stepPath("improve")).toBe("/improve");
  });

  it("reads the step back out of a pathname", () => {
    expect(stepFromPathname("/es/list")).toBe("list");
    expect(stepFromPathname("/en/result/")).toBe("result");
    expect(stepFromPathname("/list")).toBe("list");
    expect(stepFromPathname("/es")).toBeNull();
    expect(stepFromPathname("/es/nope")).toBeNull();
    expect(stepFromPathname("/")).toBeNull();
  });

  it("tells the completion page from a step, whatever the locale prefix", () => {
    expect(isFinishPathname("/es/finish")).toBe(true);
    expect(isFinishPathname("/en/finish/")).toBe(true);
    expect(isFinishPathname("/finish")).toBe(true);
    expect(isFinishPathname("/es/result")).toBe(false);
    expect(isFinishPathname("/es")).toBe(false);
    expect(isFinishPathname("/")).toBe(false);
    // Not a step, so the step lookup must not claim it either.
    expect(stepFromPathname("/es/finish")).toBeNull();
  });

  it("walks forward and backward, stopping at the ends", () => {
    expect(previousSlug("student")).toBeNull();
    expect(nextSlug("student")).toBe("list");
    expect(nextSlug("result")).toBe("improve");
    expect(previousSlug("improve")).toBe("result");
    expect(nextSlug("improve")).toBeNull();
  });

  it("gives the generic Continue only to the steps without their own choice", () => {
    // step 3 ends with the explicit finish / improve pair, so the
    // shell's bar must not offer a third, unlabelled way forward.
    expect(STEP_SLUGS.filter(ownsForwardChoice)).toEqual(["result"]);
  });
});

/**
 * The shell reads its copy by id, and next-intl only reports a miss at runtime,
 * in the locale that happens to be on screen. These assertions turn a missing or
 * one-sided translation into a failing unit test instead.
 */
describe("message ids resolve in both locales", () => {
  function lookup(messages: unknown, key: string): unknown {
    return key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        messages,
      );
  }

  const catalogues = { es, en };

  it.each(STEP_SLUGS)("step %s has a title and a lead sentence", (slug) => {
    for (const [locale, messages] of Object.entries(catalogues)) {
      expect(
        lookup(messages, STEP_TITLE_KEY[slug]),
        `${locale}: ${STEP_TITLE_KEY[slug]}`,
      ).toBeTypeOf("string");
      expect(
        lookup(messages, STEP_LEAD_KEY[slug]),
        `${locale}: ${STEP_LEAD_KEY[slug]}`,
      ).toBeTypeOf("string");
      expect(
        lookup(messages, `steps.${STEP_LABEL_KEY[slug]}`),
        `${locale}: steps.${STEP_LABEL_KEY[slug]}`,
      ).toBeTypeOf("string");
    }
  });

  it.each(["back", "continue", "progress", "locked"])(
    "the nav and stepper chrome has steps.%s",
    (leaf) => {
      for (const [locale, messages] of Object.entries(catalogues)) {
        expect(
          lookup(messages, `steps.${leaf}`),
          `${locale}: steps.${leaf}`,
        ).toBeTypeOf("string");
      }
    },
  );

  it.each([
    "student.idLabel",
    "student.idPlaceholder",
    "app.welcome.headline",
    "app.welcome.question",
    "app.welcome.yes",
    "app.welcome.no",
    "app.finish.title",
    "app.finish.lead",
    "app.finish.studentIdLabel",
    "app.finish.print",
    "app.finish.chanceLabel",
    "app.finish.staleNote",
    "app.finish.listTitle",
    "app.finish.listEmpty",
    "app.finish.locationUnknown",
    "app.finish.official",
    "app.finish.backToResult",
    "app.finish.backToStart",
    "student.idValid",
    "errors.invalidStudentId",
    "errors.invalidRunCheckDigit",
    "filters.region.label",
  ])("the step bodies have %s", (key) => {
    for (const [locale, messages] of Object.entries(catalogues)) {
      expect(lookup(messages, key), `${locale}: ${key}`).toBeTypeOf("string");
    }
  });

  it("says something different in each locale", () => {
    for (const slug of STEP_SLUGS) {
      expect(lookup(es, STEP_TITLE_KEY[slug])).not.toBe(
        lookup(en, STEP_TITLE_KEY[slug]),
      );
    }
  });
});
