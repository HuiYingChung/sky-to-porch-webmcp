import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { validateEvidenceObject } from "@/contracts/evidence";
import { queryFloodFixture } from "@/lib/flood/fixture-adapter";
import { finalizeFloodQueryResult } from "@/lib/flood/service";
import {
  FLOOD_PINNED_FIXTURE_DATE,
  FLOOD_UNSUPPORTED_FIXTURE_DATE,
} from "@/lib/flood/types";

describe("WP-08 deterministic Flood product flow", () => {
  it("validates the source-failure fixture stored on disk", () => {
    const raw = JSON.parse(readFileSync(resolve(
      process.cwd(),
      "src/data/fixtures/wp08/flood-source-failure.json"
    ), "utf8")) as Record<string, unknown>;
    const metadata = Object.keys(raw).filter((key) => key.startsWith("_"));
    expect(metadata).toEqual(["_fixtureId", "_fixtureDescription", "_fixtureWarning"]);
    for (const key of metadata) delete raw[key];
    expect(() => validateEvidenceObject(raw)).not.toThrow();
    expect(raw).toMatchObject({
      hazardId: "flood_storm",
      evidenceState: "source_failure",
      dataMode: "failed",
      observations: [],
    });
  });

  it("runs Houston fixture through validation, evaluation, separation, and deterministic explanation", async () => {
    const result = await finalizeFloodQueryResult(queryFloodFixture({
      placeId: "demo-houston",
      date: FLOOD_PINNED_FIXTURE_DATE,
      mode: "fixture",
    }), "travel", null);

    expect(result.kind).toBe("success");
    expect(result.evidence?.explanations).toHaveLength(1);
    expect(result.assessments).toHaveLength(6);
    expect(result.explanationStatus).toEqual({ mode: "deterministic", reason: "ai_unavailable" });
    expect(result.assessments?.find((item) => item.code === "route_disruption")?.status)
      .toBe("not_supported");
    expect(result.assessments?.find((item) => item.code === "property_impact")?.status)
      .toBe("not_supported");
    validateEvidenceObject(result.evidence);
  });

  it("preserves unsupported coverage as a distinct validated product state", async () => {
    const result = await finalizeFloodQueryResult(queryFloodFixture({
      placeId: "demo-houston",
      date: FLOOD_UNSUPPORTED_FIXTURE_DATE,
      mode: "fixture",
    }), "home", null);
    expect(result.kind).toBe("unsupported_coverage");
    expect(result.evidence?.evidenceState).toBe("unsupported_coverage");
    expect(result.assessments?.every((item) => item.status !== "evidence_present")).toBe(true);
  });

  it("preserves source failure without substituting the successful fixture", async () => {
    const result = await finalizeFloodQueryResult(queryFloodFixture({
      placeId: "demo-source-failure",
      date: FLOOD_PINNED_FIXTURE_DATE,
      mode: "fixture",
    }), "home", null);
    expect(result.kind).toBe("source_failure");
    expect(result.evidence?.dataMode).toBe("failed");
    expect(result.evidence?.observations).toEqual([]);
    expect(result.assessments?.every((item) => item.status !== "evidence_present")).toBe(true);
  });

  it("never substitutes Houston evidence for another place or date", () => {
    expect(queryFloodFixture({
      placeId: "demo-los-angeles",
      date: FLOOD_PINNED_FIXTURE_DATE,
      mode: "fixture",
    }).evidence).toBeUndefined();
    expect(queryFloodFixture({
      placeId: "demo-houston",
      date: "2024-07-09",
      mode: "fixture",
    }).evidence).toBeUndefined();
  });
});
