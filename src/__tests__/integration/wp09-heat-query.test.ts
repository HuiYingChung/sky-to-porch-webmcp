import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import { queryHeatFixture } from "@/lib/heat/fixture-adapter";
import { finalizeHeatQueryResult } from "@/lib/heat/service";
import {
  HEAT_PINNED_FIXTURE_DATE,
  HEAT_UNSUPPORTED_FIXTURE_DATE,
} from "@/lib/heat/types";

describe("WP-09 deterministic Extreme Heat product flow", () => {
  it.each([
    ["heat-success.json", "observations_returned", "fixture"],
    ["heat-source-failure.json", "source_failure", "failed"],
    ["heat-unsupported-coverage.json", "unsupported_coverage", "fixture"],
  ])("validates %s from disk", (file, evidenceState, dataMode) => {
    const raw = JSON.parse(readFileSync(resolve(
      process.cwd(),
      `src/data/fixtures/wp09/${file}`
    ), "utf8")) as Record<string, unknown>;
    for (const key of Object.keys(raw)) if (key.startsWith("_")) delete raw[key];
    expect(() => validateEvidenceObject(raw)).not.toThrow();
    expect(raw).toMatchObject({ hazardId: "extreme_heat", evidenceState, dataMode });
  });

  it("runs Tucson through validation, evaluation, separation, and deterministic explanation", async () => {
    const result = await finalizeHeatQueryResult(queryHeatFixture({
      placeId: "demo-tucson",
      date: HEAT_PINNED_FIXTURE_DATE,
      mode: "fixture",
    }), "home", null);
    expect(result.kind).toBe("success");
    expect(result.assessments).toHaveLength(6);
    expect(result.explanationStatus).toEqual({ mode: "deterministic", reason: "ai_unavailable" });
    expect(result.assessments?.find((item) => item.code === "indoor_temperature")?.status)
      .toBe("not_supported");
    expect(result.assessments?.find((item) => item.code === "household_heat_certainty")?.status)
      .toBe("not_supported");
    expect(result.assessments?.find((item) => item.code === "individual_medical_risk")?.status)
      .toBe("not_supported");
  });

  it("keeps unsupported coverage and source failure non-positive", async () => {
    for (const input of [
      { placeId: "demo-tucson", date: HEAT_UNSUPPORTED_FIXTURE_DATE, mode: "fixture" as const },
      { placeId: "demo-source-failure", date: HEAT_PINNED_FIXTURE_DATE, mode: "fixture" as const },
    ]) {
      const result = await finalizeHeatQueryResult(queryHeatFixture(input), "health", null);
      expect(result.assessments?.every((item) => item.status !== "evidence_present")).toBe(true);
      expect(result.explanation?.notSupported.join(" ")).toMatch(/not|cannot|does not/i);
    }
  });
});
