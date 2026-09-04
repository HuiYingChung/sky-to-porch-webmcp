import { describe, expect, it } from "vitest";
import { HAZARD_IDS } from "@/contracts/common";
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
      hazards: Array<{
        label: string;
        tool_input: { hazard: string; related_hazards: string[] };
      }>;
      demo_scenarios: Array<{
        title: string;
        tool_input: Record<string, unknown>;
      }>;
      missing_hazard_guidance: string;
    };

    expect(tool.name).toBe(CAPABILITIES_TOOL_NAME);
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false });
    expect(output).toMatchObject({
      status: "hazard_catalog",
      status_label: "Supported environmental hazards",
      display_summary: expect.stringMatching(/seven environmental hazard groups/iu),
      missing_hazard_guidance: "Ask which hazard they mean, then wait.",
      ui_updated: false,
    });
    expect(output.hazards.map((item) => item.tool_input.hazard)).toEqual(HAZARD_IDS);
    expect(output.demo_scenarios).toHaveLength(3);
    for (const scenario of WEBMCP_DEMO_SCENARIOS) {
      const { start_date: startDate, end_date: endDate, ...analysisInput } =
        scenario.analysisInput;
      expect(output.demo_scenarios.find((item) => item.title === scenario.title))
        .toMatchObject({
          title: scenario.title,
          tool_input: {
            ...analysisInput,
            time: startDate === endDate ? startDate : `${startDate}/${endDate}`,
            analysis_scope: "related_context",
          },
        });
      expect(String(output.demo_scenarios.find(
        (item) => item.title === scenario.title
      )?.tool_input.question).length).toBeLessThanOrEqual(35);
    }
    expect(output.hazards.find((item) => item.tool_input.hazard === "wind_storm"))
      .toMatchObject({ tool_input: { related_hazards: ["flood_storm"] } });
    expect(output.hazards.find((item) => item.tool_input.hazard === "earth_volcanoes"))
      .toMatchObject({ tool_input: { related_hazards: ["air_quality", "extreme_heat"] } });
    expect(output.hazards.map((item) => item.label)).toEqual([
      "Fire & Smoke",
      "Flood & Heavy Rain",
      "Wind & Storm",
      "Extreme Heat",
      "Drought & Land",
      "Air Quality",
      "Earth & Volcanoes",
    ]);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toMatch(/missing_hazard_request|default_analysis_scope|ask_person_to_choose_hazard_and_wait|do_not_analyze_or_guess|analysis_input|demo_id/u);
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
        hazard_label: string;
        source_count: number;
        sources: Array<{
          source_name: string;
          availability: string;
          region: string;
          time_range: string;
        }>;
      };
      const expected = SOURCE_COVERAGE_PROFILES.filter((profile) =>
        profile.hazardIds.includes(hazard)
      );
      expect(output).toMatchObject({
        status: "coverage_catalog",
        status_label: expect.any(String),
        display_summary: expect.stringMatching(/sources|coverage/iu),
        source_count: expected.length,
      });
      expect(output.sources.map((item) => item.source_name)).toEqual(
        expected.map((profile) => profile.publicName)
      );
      expect(output.sources.every((item) => item.time_range.length > 0)).toBe(true);
      expect(output.sources.every((item) => item.region.length > 0)).toBe(true);
      expect(output.sources.every((item) => item.availability.length > 0)).toBe(true);
      expect(output.sources.every((item) => !item.source_name.includes("_"))).toBe(true);
      const serialized = JSON.stringify(output);
      expect(serialized).not.toMatch(/"(?:hazard|source_id|integration_status|evidence_role|coverage_scope|live_sources_queried|actual_observation_not_established|next_step)"\s*:/u);
      for (const profile of expected) {
        expect(serialized).not.toContain(profile.sourceId);
      }
      expect(serialized.length).toBeLessThanOrEqual(
        MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS
      );
    }
  });

  it("fails closed for missing, unknown, or unexpected coverage input", async () => {
    const tool = createGetEnvironmentalSourceCoverageTool();
    const rejected = await Promise.all([
      tool.execute({}, options),
      tool.execute({ hazard: "tornado" }, options),
      tool.execute({ hazard: "fire_smoke", internal_debug_code: true }, options),
    ]);
    for (const output of rejected) {
      expect(output).toMatchObject({
        status: "invalid_input",
        status_label: "Request could not be used",
      });
      const serialized = JSON.stringify(output);
      expect(serialized).not.toMatch(/tornado|internal_debug_code|Unexpected input field|hazard must be one of/u);
    }
  });
});
