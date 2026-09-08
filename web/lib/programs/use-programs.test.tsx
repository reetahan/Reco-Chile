import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProgramListResponse } from "@/lib/api/types";
import { emptyFilters } from "@/lib/store/wizard";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("next-intl", () => ({ useLocale: () => "es" }));
vi.mock("@/lib/api/client", () => ({
  api: {
    get: (...args: unknown[]) => get(...args) as unknown,
  },
}));

import {
  clearProgramCache,
  PROGRAM_SEARCH_DEBOUNCE_MS,
  useProgramSearch,
} from "./use-programs";

function listResponse(labels: string[]): ProgramListResponse {
  return {
    items: labels.map((label, index) => ({
      program_id: `${index}:${index}`,
      program_label: label,
      school_name: label,
      school_commune: "Arica",
      region: "Región de Arica y Parinacota",
      program_display_name: "General H-C",
      program_track: "General",
      program_specialty_sector: "General academic",
      program_gender: "Mixed",
      program_school_day: "Full day",
      program_rurality: "Urban",
      program_pie: "With PIE",
      program_pace: "With PACE",
      program_enrollment_fee: "Free",
      program_monthly_fee: "Free",
      program_religious_orientation: "Secular",
      capacity: 10,
      true_applicants_last_year: 20,
      calibration_imputed: false,
    })),
    total_matched: labels.length,
    truncated: false,
    offset: 0,
    limit: 50,
  };
}

/** Let the debounce elapse and the mocked promise settle. */
async function flush(ms = PROGRAM_SEARCH_DEBOUNCE_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  get.mockResolvedValue(listResponse(["Liceo Uno"]));
  clearProgramCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useProgramSearch", () => {
  it("waits out the debounce window before calling the API", async () => {
    const { result } = renderHook(() => useProgramSearch({ q: "liceo" }));

    // Loading is true immediately: the combobox says "searching…" on the first
    // keystroke, not 250 ms later.
    expect(result.current.loading).toBe(true);
    expect(get).not.toHaveBeenCalled();

    await flush(PROGRAM_SEARCH_DEBOUNCE_MS - 1);
    expect(get).not.toHaveBeenCalled();

    await flush(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.items.map((p) => p.program_label)).toEqual([
      "Liceo Uno",
    ]);
    expect(result.current.totalMatched).toBe(1);
  });

  it("collapses a burst of keystrokes into one request", async () => {
    const { rerender } = renderHook(({ q }) => useProgramSearch({ q }), {
      initialProps: { q: "l" },
    });

    for (const q of ["li", "lic", "lice", "liceo"]) {
      await flush(50);
      rerender({ q });
    }
    expect(get).not.toHaveBeenCalled();

    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][1]).toMatchObject({
      query: { q: "liceo" },
      lang: "es",
    });
  });

  it("issues no request when the inputs did not really change", async () => {
    const { rerender } = renderHook(({ q }) => useProgramSearch({ q }), {
      initialProps: { q: "liceo" },
    });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);

    // A new object identity for the same filters must not re-fetch.
    rerender({ q: "liceo" });
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("re-runs when a filter changes and sends the repeatable parameters", async () => {
    const { rerender } = renderHook(
      ({ filters }) => useProgramSearch({ filters }),
      { initialProps: { filters: emptyFilters() } },
    );
    await flush();
    expect(get.mock.calls[0]).toEqual([
      "/programs",
      expect.objectContaining({ query: { limit: 50 } }),
    ]);

    rerender({
      filters: {
        ...emptyFilters(),
        region: "Región de Los Ríos",
        tracks: ["Specialized"],
        specialtySectors: ["Electricity"],
      },
    });
    await flush();

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][1]).toMatchObject({
      query: {
        region: "Región de Los Ríos",
        track: ["Specialized"],
        specialty_sector: ["Electricity"],
        limit: 50,
      },
    });
  });

  it("lets an explicit region override the filters", async () => {
    renderHook(() =>
      useProgramSearch({
        region: null,
        filters: { ...emptyFilters(), region: "Región de Los Ríos" },
      }),
    );
    await flush();
    expect(get.mock.calls[0][1].query).not.toHaveProperty("region");
  });

  it("issues nothing while disabled", async () => {
    const { result } = renderHook(() =>
      useProgramSearch({ q: "liceo", enabled: false }),
    );
    await flush();
    expect(get).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it("surfaces a failure instead of stale results", async () => {
    get.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useProgramSearch({ q: "liceo" }));
    await flush();

    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.error?.message).toBe("boom");
  });

  it("drops a superseded request rather than letting it land late", async () => {
    const { rerender, result } = renderHook(
      ({ q }) => useProgramSearch({ q }),
      {
        initialProps: { q: "uno" },
      },
    );
    get.mockResolvedValueOnce(listResponse(["Liceo Uno"]));
    await flush();

    get.mockResolvedValueOnce(listResponse(["Liceo Dos"]));
    rerender({ q: "dos" });
    await flush();

    expect(result.current.items.map((p) => p.program_label)).toEqual([
      "Liceo Dos",
    ]);
  });
});
