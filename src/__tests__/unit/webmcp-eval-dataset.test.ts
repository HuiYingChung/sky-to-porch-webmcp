import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HAZARD_IDS } from "@/contracts/common";
import {
  ANALYZE_HAZARD_INPUT_SCHEMA,
  ANALYZE_HAZARD_TOOL_NAME,
} from "@/lib/webmcp/analyze-tool";
import {
  GET_COVERAGE_INPUT_SCHEMA,
  GET_COVERAGE_TOOL_NAME,
  LIST_HAZARDS_INPUT_SCHEMA,
  LIST_HAZARDS_TOOL_NAME,
} from "@/lib/webmcp/discovery-tools";
import {
  INSPECT_EVIDENCE_INPUT_SCHEMA,
  INSPECT_EVIDENCE_TOOL_NAME,
  PREPARE_STORM_CLAIM_INPUT_SCHEMA,
  PREPARE_STORM_CLAIM_TOOL_NAME,
} from "@/lib/webmcp/context-tools";

interface EvalCall {
  functionName: string;
  arguments: Record<string, unknown>;
}

interface EvalCase {
  id: string;
  availableAfter?: "completed_environmental_analysis" | "completed_home_wind_analysis";
  messages: Array<{ role: "user"; content: string }>;
  expectedCall: EvalCall[];
}

describe("WebMCP tool-selection eval dataset", () => {
  const dataset = JSON.parse(readFileSync(resolve(
    process.cwd(),
    "tests/webmcp/tool-selection-evals.json"
  ), "utf8")) as EvalCase[];

  it("has unique bounded cases including an out-of-scope no-call", () => {
    expect(dataset.length).toBeGreaterThanOrEqual(6);
    expect(new Set(dataset.map((item) => item.id)).size).toBe(dataset.length);
    expect(dataset.some((item) => item.expectedCall.length === 0)).toBe(true);
    expect(dataset.some((item) => item.id.includes("ambiguous"))).toBe(true);
  });

  it("keeps expected calls aligned with the registered tool contract", () => {
    const schemas = {
      [ANALYZE_HAZARD_TOOL_NAME]: ANALYZE_HAZARD_INPUT_SCHEMA.properties,
      [LIST_HAZARDS_TOOL_NAME]: LIST_HAZARDS_INPUT_SCHEMA.properties,
      [GET_COVERAGE_TOOL_NAME]: GET_COVERAGE_INPUT_SCHEMA.properties,
      [INSPECT_EVIDENCE_TOOL_NAME]: INSPECT_EVIDENCE_INPUT_SCHEMA.properties,
      [PREPARE_STORM_CLAIM_TOOL_NAME]: PREPARE_STORM_CLAIM_INPUT_SCHEMA.properties,
    };
    for (const item of dataset) {
      expect(item.messages).toHaveLength(1);
      expect(item.messages[0].content.trim().length).toBeGreaterThan(0);
      for (const call of item.expectedCall) {
        expect(schemas).toHaveProperty(call.functionName);
        const properties = schemas[call.functionName as keyof typeof schemas];
        for (const key of Object.keys(call.arguments)) {
          expect(properties).toHaveProperty(key);
        }
        if (call.functionName === ANALYZE_HAZARD_TOOL_NAME) {
          expect(call.arguments).toHaveProperty("place");
          expect(call.arguments).toHaveProperty("hazard");
        }
        if (call.functionName === GET_COVERAGE_TOOL_NAME) {
          expect(call.arguments).toHaveProperty("hazard");
        }
      }
    }
  });

  it("gives every registered baseline and contextual tool a natural trigger case", () => {
    const calledTools = new Set(dataset.flatMap((item) =>
      item.expectedCall.map((call) => call.functionName)
    ));
    expect(calledTools).toEqual(new Set([
      ANALYZE_HAZARD_TOOL_NAME,
      LIST_HAZARDS_TOOL_NAME,
      GET_COVERAGE_TOOL_NAME,
      INSPECT_EVIDENCE_TOOL_NAME,
      PREPARE_STORM_CLAIM_TOOL_NAME,
    ]));
    expect(dataset.find((item) => item.id === "inspect-after-custom-analysis")?.availableAfter)
      .toBe("completed_environmental_analysis");
    expect(dataset.find((item) => item.id === "prepare-claim-after-home-wind")?.availableAfter)
      .toBe("completed_home_wind_analysis");
  });

  it("covers every hazard with non-demo questions through the shared analysis tool", () => {
    const analyzedHazards = new Set(dataset.flatMap((item) =>
      item.expectedCall
        .filter((call) => call.functionName === ANALYZE_HAZARD_TOOL_NAME)
        .map((call) => call.arguments.hazard)
    ));
    expect(analyzedHazards).toEqual(new Set(HAZARD_IDS));
  });

  it("uses discovery only for capability questions and keeps concrete asks direct", () => {
    expect(dataset.find((item) => item.id === "capability-discovery")?.expectedCall[0])
      .toMatchObject({ functionName: LIST_HAZARDS_TOOL_NAME, arguments: {} });
    expect(dataset.find((item) => item.id === "coverage-discovery-air-quality")?.expectedCall[0])
      .toMatchObject({
        functionName: GET_COVERAGE_TOOL_NAME,
        arguments: { hazard: "air_quality" },
      });
    for (const id of [
      "direct-fire-place",
      "implicit-heat-pets",
      "beryl-broad-home-damage-auto-bundle",
      "los-angeles-health-demo",
      "tucson-pets-demo",
      "historical-wind-no-concern",
    ]) {
      expect(dataset.find((item) => item.id === id)?.expectedCall[0]?.functionName)
        .toBe(ANALYZE_HAZARD_TOOL_NAME);
    }
  });

  it("lets narrow historical evidence asks proceed without concern and broad goals ask first", () => {
    const narrow = dataset.find((item) => item.id === "historical-wind-no-concern");
    const broad = dataset.find((item) => item.id === "broad-goal-ask-clarification");
    expect(narrow?.expectedCall[0]).toMatchObject({
      functionName: ANALYZE_HAZARD_TOOL_NAME,
      arguments: { place: "Houston", hazard: "wind_storm" },
    });
    expect(narrow?.expectedCall[0].arguments).not.toHaveProperty("concern");
    expect(broad?.expectedCall).toEqual([]);
  });

  it("selects a curated demo through the existing discovery tool before analysis", () => {
    const selected = dataset.find((item) => item.id === "selected-tucson-demo");
    expect(selected?.expectedCall.map((call) => call.functionName)).toEqual([
      LIST_HAZARDS_TOOL_NAME,
      ANALYZE_HAZARD_TOOL_NAME,
    ]);
    expect(selected?.expectedCall[0].arguments).toEqual({ demo_id: "tucson-heat-pets" });
  });

  it("uses single scope only for explicit asks and defaults broad questions to related context", () => {
    const gust = dataset.find((item) => item.id === "beryl-specific-wind-gust");
    const water = dataset.find((item) => item.id === "completed-flood-date");
    const broad = dataset.find((item) => item.id === "beryl-broad-home-damage-auto-bundle");
    const heatDrought = dataset.find((item) => item.id === "broad-heat-drought-context");
    const smokeAir = dataset.find((item) => item.id === "broad-smoke-air-context");
    const volcanoAirHeat = dataset.find((item) => item.id === "broad-volcano-air-heat-context");
    expect(gust?.expectedCall.map((call) => call.arguments.hazard)).toEqual(["wind_storm"]);
    expect(gust?.expectedCall[0].arguments.analysis_scope).toBe("single_hazard_only");
    expect(water?.expectedCall.map((call) => call.arguments.hazard)).toEqual(["flood_storm"]);
    expect(water?.expectedCall[0].arguments.analysis_scope).toBe("single_hazard_only");
    expect(broad?.expectedCall.map((call) => call.arguments.hazard)).toEqual(["wind_storm"]);
    expect(broad?.expectedCall[0].arguments.analysis_scope).toBeUndefined();
    expect(heatDrought?.expectedCall[0].arguments.hazard).toBe("extreme_heat");
    expect(smokeAir?.expectedCall[0].arguments.hazard).toBe("fire_smoke");
    expect(volcanoAirHeat?.expectedCall[0].arguments.hazard).toBe("earth_volcanoes");
  });
});
