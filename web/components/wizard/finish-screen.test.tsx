import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProgramSummary, SimulationResponse } from "@/lib/api/types";
import { formatPercent } from "@/lib/format";
import { useWizardStore } from "@/lib/store/wizard";
import es from "@/messages/es";

import { FinishScreen } from "./finish-screen";

/**
 * The completion page.
 *
 * It is deliberately unreachable by a deep link — the simulation it reports is
 * memory-only, so the family can only arrive from the result step by a
 * client-side navigation — which is why its rendering is asserted here rather
 * than in Playwright; `e2e/wizard.spec.ts` covers the guard that sends everyone
 * else away.
 *
 * The Spanish catalogue is used verbatim, never a string frozen here, so
 * rewording the copy does not fail a test that is about behaviour.
 */

const replace = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/finish",
}));

/** Two programs, as `/programs/{id}` would answer for the seeded wishes. */
const PROGRAMS: Record<
  string,
  Pick<
    ProgramSummary,
    "program_id" | "program_label" | "school_commune" | "region"
  >
> = {
  "1001:A": {
    program_id: "1001:A",
    program_label: "Liceo Uno · Científico-Humanista",
    school_commune: "Santiago",
    region: "Metropolitana",
  },
  "1002:B": {
    program_id: "1002:B",
    program_label: "Colegio Dos · Técnico Profesional",
    school_commune: "Puente Alto",
    region: "Metropolitana",
  },
};

vi.mock("@/lib/programs", () => ({
  usePrograms: (ids: readonly string[]) => ({
    programs: new Map(
      ids.filter((id) => id in PROGRAMS).map((id) => [id, PROGRAMS[id]]),
    ),
    loading: false,
    missing: [],
  }),
}));

const SIMULATION = {
  unmatched_risk: 0.12,
  at_risk: false,
  attention_level: "low",
  thresholds: { hard: 0.5, soft: 0.25 },
  predicted_outcome: "Liceo Uno",
  predicted_outcome_program_id: "1001:A",
  outcomes: [],
  wishes: [],
} satisfies SimulationResponse;

const copy = es.app.finish;

function renderFinish() {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      <FinishScreen />
    </NextIntlClientProvider>,
  );
}

/** A store in the only state that reaches this page: a fresh simulation. */
function seed() {
  const store = useWizardStore.getState();
  store.setListExists(true);
  store.setStudentId("12.345.678-5");
  store.addWish("1001:A");
  store.addWish("1002:B");
  store.setSimulation(SIMULATION);
}

beforeEach(() => {
  window.sessionStorage.clear();
  useWizardStore.getState().reset();
  replace.mockClear();
  // jsdom has no real print dialog; the button only needs to reach it.
  window.print = vi.fn();
});

describe("FinishScreen", () => {
  it("closes the wizard with the completion headline", () => {
    seed();
    renderFinish();

    expect(
      screen.getByRole("heading", { level: 1, name: copy.title }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("finish")).toHaveTextContent(copy.lead);
  });

  it("shows the student identifier masked to its last four body digits", () => {
    seed();
    renderFinish();

    // Seeded RUN is 12.345.678-5.
    expect(screen.getByTestId("finish-student-id")).toHaveTextContent(
      "…5678-5",
    );
    expect(screen.getByTestId("finish-student-id")).not.toHaveTextContent(
      "12.345.678",
    );
  });

  it("saves a copy through the browser print dialog", async () => {
    const user = userEvent.setup();
    seed();
    renderFinish();

    await user.click(screen.getByTestId("finish-print"));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("repeats the chance of being assigned — 1 − unmatched risk", () => {
    seed();
    renderFinish();

    expect(screen.getByTestId("finish-chance")).toHaveTextContent(
      formatPercent(1 - SIMULATION.unmatched_risk, "es"),
    );
    expect(screen.queryByTestId("finish-chance-stale")).toBeNull();
  });

  it("shows the final list in order, with commune and region", () => {
    seed();
    renderFinish();

    const items = screen.getAllByTestId("finish-wish");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(PROGRAMS["1001:A"].program_label);
    expect(items[0]).toHaveTextContent("Santiago · Metropolitana");
    expect(items[1]).toHaveTextContent(PROGRAMS["1002:B"].program_label);

    // Read-only: nothing here can edit the list.
    expect(screen.queryByRole("button", { name: /elimina|quita/i })).toBeNull();
  });

  it("says the official application happens elsewhere", () => {
    seed();
    renderFinish();

    expect(screen.getByTestId("finish-official")).toHaveTextContent(
      copy.official,
    );
  });

  it("offers the way back to the result", () => {
    seed();
    renderFinish();

    const back = screen.getByTestId("finish-back");
    expect(back).toHaveTextContent(copy.backToResult);
    expect(back).toHaveAttribute("href", "/result");
  });

  it("goes back to the start by clearing the store and returning to the welcome page", async () => {
    const user = userEvent.setup();
    seed();
    renderFinish();

    const backToStart = screen.getByTestId("finish-start-over");
    expect(backToStart).toHaveTextContent(copy.backToStart);
    await user.click(backToStart);

    const state = useWizardStore.getState();
    expect(state.wishes).toEqual([]);
    expect(state.studentId).toBe("");
    expect(state.simulation).toBeNull();
    // `listExists === null` is what puts the welcome question back in front of
    // the family; the redirect is explicit as well.
    expect(state.listExists).toBeNull();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("falls back to a prompt when the stored simulation is stale", () => {
    seed();
    // Any list change invalidates it; the guard normally redirects, so
    // this is the defensive branch.
    useWizardStore.getState().addWish("1003:C");
    renderFinish();

    expect(screen.queryByTestId("finish-chance")).toBeNull();
    expect(screen.getByTestId("finish-chance-stale")).toHaveTextContent(
      copy.staleNote,
    );
  });
});
