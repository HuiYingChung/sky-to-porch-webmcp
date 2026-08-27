import { describe, expect, it } from "vitest";
import { HAZARD_IDS } from "@/contracts/common";
import { SOURCE_COVERAGE_PROFILES } from "@/data/source-coverage";
import {
  createGetEnvironmentalSourceCoverageTool,
  createListEnvironmentalHazardsTool,
  GET_COVERAGE_INPUT_SCHEMA,
  GET_COVERAGE_TOOL_NAME,
  LIST_HAZARDS_TOOL_NAME,
  MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS,
} from "@/lib/webmcp/discovery-tools";

const options = { signal: new AbortController().signal } as WebMCP.ToolExecuteCallbackOptions;

describe("WebMCP discovery tools", () => {
  it("lists every governed hazard and related-context default without updating the UI", async () => {
    const tool = createListEnvironmentalHazardsTool();
    const output = await tool.execute({}, options) as {
      hazards: Array<{ hazard: string; default_related_hazards: string[] }>;
    };

    expect(tool.name).toBe(LIST_HAZARDS_TOOL_NAME);
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false });
    expect(output).toMatchObject({
      status: "hazard_catalog",
      default_analysis_scope: "related_context",
      relationship: "co_occurring_context_not_causation",
      ui_updated: false,
      no_data_is_not_no_danger: true,
    });
    expect(output.hazards.map((item) => item.hazard)).toEqual(HAZARD_IDS);
    expect(output.hazards.find((item) => item.hazard === "wind_storm"))
      .toMatchObject({ default_related_hazards: ["flood_storm"] });
    expect(output.hazards.find((item) => item.hazard === "earth_volcanoes"))
      .toMatchObject({ default_related_hazards: ["air_quality", "extreme_heat"] });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(
      MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS
    );
  });

  it("rejects input for the no-input hazard catalog", async () => {
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
        no_data_is_not_no_danger: true,
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
