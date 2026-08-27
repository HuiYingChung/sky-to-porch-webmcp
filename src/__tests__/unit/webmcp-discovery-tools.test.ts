import { describe, expect, it } from "vitest";
import { CONCERN_TYPES, HAZARD_IDS } from "@/contracts/common";
import { WEBMCP_DEMO_SCENARIOS } from "@/data/places/demo-stories";
import { SOURCE_COVERAGE_PROFILES } from "@/data/source-coverage";
import {
  createGetEnvironmentalSourceCoverageTool,
  createListEnvironmentalHazardsTool,
  GET_COVERAGE_INPUT_SCHEMA,
  GET_COVERAGE_TOOL_NAME,
  LIST_HAZARDS_INPUT_SCHEMA,
  LIST_HAZARDS_TOOL_NAME,
  MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS,
} from "@/lib/webmcp/discovery-tools";

const options = { signal: new AbortController().signal } as WebMCP.ToolExecuteCallbackOptions;

describe("WebMCP discovery tools", () => {
  it("lists every governed hazard and related-context default without updating the UI", async () => {
    const tool = createListEnvironmentalHazardsTool();
    const output = await tool.execute({}, options) as {
      hazards: Array<{ hazard: string; default_related_hazards: string[] }>;
      concerns: string[];
      demo_scenarios: Array<{ id: string; title: string }>;
    };

    expect(tool.name).toBe(LIST_HAZARDS_TOOL_NAME);
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false });
    expect(output).toMatchObject({
      status: "hazard_catalog",
      default_analysis_scope: "related_context",
      relationship: "related_evidence_for_assessment",
      ui_updated: false,
    });
    expect(output.hazards.map((item) => item.hazard)).toEqual(HAZARD_IDS);
    expect(output.concerns).toEqual(CONCERN_TYPES);
    expect(output.concerns[0]).toBe("general");
    expect(output.demo_scenarios).toHaveLength(3);
    expect(output.hazards.find((item) => item.hazard === "wind_storm"))
      .toMatchObject({ default_related_hazards: ["flood_storm"] });
    expect(output.hazards.find((item) => item.hazard === "earth_volcanoes"))
      .toMatchObject({ default_related_hazards: ["air_quality", "extreme_heat"] });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(
      MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS
    );
  });

  it("returns one selected demo through the existing discovery tool", async () => {
    const tool = createListEnvironmentalHazardsTool();
    for (const scenario of WEBMCP_DEMO_SCENARIOS) {
      const output = await tool.execute({ demo_id: scenario.id }, options);
      expect(output).toMatchObject({
        status: "demo_scenario",
        scenario: {
          id: scenario.id,
          prompt: scenario.prompt,
          analysis_input: {
            hazard: scenario.analysisInput.hazard,
            concern: scenario.analysisInput.concern,
            analysis_scope: "related_context",
          },
        },
        ui_updated: false,
      });
      expect(JSON.stringify(output).length).toBeLessThanOrEqual(
        MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS
      );
    }
    for (const property of Object.values(LIST_HAZARDS_INPUT_SCHEMA.properties)) {
      expect(property.description.length).toBeLessThanOrEqual(150);
    }
  });

  it("rejects unexpected hazard-catalog input", async () => {
    const output = await createListEnvironmentalHazardsTool().execute(
      { hazard: "fire_smoke" },
      options
    );
    expect(output).toMatchObject({ status: "invalid_input", ui_updated: false });
  });

  it("summarizes every hazard from the shared coverage catalog without a live request", async () => {
    const tool = createGetEnvironmentalSourceCoverageTool();
    expect(tool.name).toBe(GET_COVERAGE_TOOL_NAME);
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false });
    for (const property of Object.values(GET_COVERAGE_INPUT_SCHEMA.properties)) {
      expect(property.description.length).toBeLessThanOrEqual(150);
    }

    for (const hazard of HAZARD_IDS) {
      const output = await tool.execute({ hazard }, options) as {
        source_count: number;
        sources: Array<{ source_id: string }>;
      };
      const expected = SOURCE_COVERAGE_PROFILES.filter((profile) =>
        profile.hazardIds.includes(hazard)
      );
      expect(output).toMatchObject({
        status: "coverage_catalog",
        hazard,
        source_count: expected.length,
        coverage_scope: "pipeline_eligibility_not_observation",
        live_sources_queried: false,
        actual_observation_not_established: true,
      });
      expect(output.sources.map((item) => item.source_id)).toEqual(
        expected.map((profile) => profile.sourceId)
      );
      expect(JSON.stringify(output).length).toBeLessThanOrEqual(
        MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS
      );
    }
  });

  it("returns one bounded source detail and rejects a cross-hazard source", async () => {
    const tool = createGetEnvironmentalSourceCoverageTool();
    for (const profile of SOURCE_COVERAGE_PROFILES) {
      const hazard = profile.hazardIds[0];
      const output = await tool.execute(
        { hazard, source_id: profile.sourceId },
        options
      );
      expect(output).toMatchObject({
        status: "coverage_profile",
        hazard,
        source: { source_id: profile.sourceId },
        coverage_scope: "pipeline_eligibility_not_observation",
        live_sources_queried: false,
        actual_observation_not_established: true,
      });
      expect(JSON.stringify(output).length).toBeLessThanOrEqual(
        MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS
      );
    }

    const crossHazard = await tool.execute(
      { hazard: "wind_storm", source_id: "nasa_firms" },
      options
    );
    expect(crossHazard).toMatchObject({ status: "invalid_input", ui_updated: false });
  });

  it("fails closed for missing, unknown, or unexpected coverage input", async () => {
    const tool = createGetEnvironmentalSourceCoverageTool();
    await expect(tool.execute({}, options)).resolves.toMatchObject({ status: "invalid_input" });
    await expect(tool.execute({ hazard: "tornado" }, options))
      .resolves.toMatchObject({ status: "invalid_input" });
    await expect(tool.execute({ hazard: "fire_smoke", extra: true }, options))
      .resolves.toMatchObject({ status: "invalid_input" });
  });
});
