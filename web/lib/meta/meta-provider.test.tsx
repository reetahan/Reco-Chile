import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Meta } from "@/lib/api/types";
import { MetaProvider, useMeta, useMetaOptional } from "./meta-provider";

const META: Meta = {
  api_version: "1.0.0",
  data_fingerprint: "deadbeef",
  hard_unmatched_threshold: 0.5,
  soft_unmatched_threshold: 0.25,
  equiv_probability_change_warning_threshold: 0.05,
  max_exact_equiv_permutations: 10000,
  recommendation_max_home_distance_km: 20,
  max_wishes: 30,
  regions: ["Región Metropolitana"],
  filter_options: {
    tracks: ["Científico-Humanista"],
    specialty_sectors: [],
    genders: [],
    school_days: [],
    rurality: [],
    pie: ["With PIE"],
    pace: [],
    enrollment_fee: [],
    monthly_fee: [],
    religious_orientation: [],
  },
};

function ThresholdReadout() {
  const meta = useMeta();
  return <span>{meta.hard_unmatched_threshold}</span>;
}

function OptionalReadout() {
  const meta = useMetaOptional();
  return <span>{meta === null ? "no meta" : meta.data_fingerprint}</span>;
}

describe("MetaProvider / useMeta", () => {
  it("hands the server-fetched /meta to the client tree", () => {
    render(
      <MetaProvider meta={META}>
        <ThresholdReadout />
      </MetaProvider>,
    );
    expect(screen.getByText("0.5")).toBeInTheDocument();
  });

  it("throws outside a provider — a missing provider is a wiring bug", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ThresholdReadout />)).toThrow(/useMeta\(\)/);
    error.mockRestore();
  });

  it("useMetaOptional returns null outside a provider", () => {
    render(<OptionalReadout />);
    expect(screen.getByText("no meta")).toBeInTheDocument();
    render(
      <MetaProvider meta={META}>
        <OptionalReadout />
      </MetaProvider>,
    );
    expect(screen.getByText("deadbeef")).toBeInTheDocument();
  });
});
