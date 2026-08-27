import { describe, expect, it } from "vitest";
import { CONCERN_TYPES, HAZARD_IDS } from "@/contracts/common";
import { WEBMCP_DEMO_SCENARIOS } from "@/data/places/demo-stories";
import { SOURCE_COVERAGE_PROFILES } from "@/data/source-coverage";
import {
  createGetEnvironmentalSourceCoverageTool,
  createEnvironmentalCapabilitiesTool,
  GET_COVERAGE_INPUT_SCHEMA,
  GET_COVERAGE_TOOL_NAME,
  CAPABILITIES_INPUT_SCHEMA,
  CAPABILITIES_TOOL_NAME,
  MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS,
} from "@/lib/webmcp/discovery-tools";

const options = { signal: new AbortController().signal } as WebMCP.ToolExecuteCallbackOptions;

describe("WebMCP discovery tools", () => {
  it("lists every governed hazard and related-context default without updating the UI", async () => {
    const tool = createEnvironmentalCapabilitiesTool();
    const output = await tool.execute({}, options) as {
      hazards: Array<{ hazard: string; default_related_hazards: string[] }>;
      concerns: string[];
      demo_scenarios: Array<{
        id: string;
        title: string;
        analysis_input: Record<string, unknown>;
      }>;
      missing_hazard_request: string;
    };

    expect(tool.name).toBe(CAPABILITIES_TOOL_NAME);
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false });
    expect(output).toMatchObject({
      status: "hazard_catalog",
      default_analysis_scope: "related_context",
      relationship: "related_evidence_for_assessment",
      missing_hazard_request:
        "ask_person_to_choose_hazard_and_wait; do_not_analyze_or_guess",
      ui_updated: false,
    });
    expect(output.hazards.map((item) => item.hazard)).toEqual(HAZARD_IDS);
    expect(output.concerns).toEqual(CONCERN_TYPES);
    expect(output.concerns[0]).toBe("general");
    expect(output.demo_scenarios).toHaveLength(3);
    for (const scenario of WEBMCP_DEMO_SCENARIOS) {
      const { start_date: startDate, end_date: endDate, ...analysisInput } =
        scenario.analysisInput;
      expect(output.demo_scenarios.find((item) => item.id === scenario.id))
        .toMatchObject({
          title: scenario.title,
          analysis_input: {
            ...analysisInput,
            time: startDate === endDate ? startDate : `${startDate}/${endDate}`,
            analysis_scope: "related_context",
          },
        });
      expect(String(output.demo_scenarios.find(
        (item) => item.id === scenario.id
      )?.analysis_input.question).length).toBeLessThanOrEqual(100);
    }
    expect(output.hazards.find((item) => item.hazard === "wind_storm"))
      .toMatchObject({ default_related_hazards: ["flood_storm"] });
    expect(output.hazards.find((item) => item.hazard === "earth_volcanoes"))
      .toMatchObject({ default_related_hazards: ["air_quality", "extreme_heat"] });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(
      MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS
    );
  });

  it("takes no selector input so the model cannot guess a demo", async () => {
    const tool = createEnvironmentalCapabilitiesTool();
    expect(tool.description).toContain(
      "Never use for concrete place+hazard, preflight, or unrelated tasks"
    );
    expect(tool.description).toContain(
      "For a missing hazard, return options, ask which one, and wait"
    );
    expect(CAPABILITIES_INPUT_SCHEMA.properties).toEqual({});
    await expect(tool.execute({ demo_id: "tucson-heat-pets" }, options))
      .resolves.toMatchObject({ status: "invalid_input", ui_updated: false });
  });

  it("rejects unexpected hazard-catalog input", async () => {
    const output = await createEnvironmentalCapabilitiesTool().execute(
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
        sources: Array<{
          source_id: string;
          temporal_coverage: string;
        }>;
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
      expect(output.sources.every((item) => item.temporal_coverage.length > 0)).toBe(true);
      expect(JSON.stringify(output).length).toBeLessThanOrEqual(
        MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS
      );
    }
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
