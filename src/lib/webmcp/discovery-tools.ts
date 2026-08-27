/// <reference types="webmcp-types" />

import { CONCERN_TYPES, HAZARD_IDS, type HazardId } from "@/contracts/common";
import type { SourceCoverageProfile } from "@/contracts/source-coverage";
import {
  HAZARD_LABELS,
  coverageProfilesForHazard,
} from "@/data/source-coverage";
import { WEBMCP_DEMO_SCENARIOS } from "@/data/places/demo-stories";
import { DEFAULT_RELATED_HAZARDS } from "@/lib/webmcp/analyze-tool";

export const CAPABILITIES_TOOL_NAME = "get_sky_to_porch_help_and_demos";
export const GET_COVERAGE_TOOL_NAME = "get_environmental_source_coverage";
export const MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS = 2_400;

export const CAPABILITIES_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

export const GET_COVERAGE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hazard"],
  properties: {
    hazard: {
      type: "string",
      enum: HAZARD_IDS,
      description: "Hazard whose checked-in source-coverage catalog should be inspected.",
    },
  },
} as const;

function compactText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

function invalidInput(message: string) {
  return {
    status: "invalid_input",
    message,
    ui_updated: false,
  } as const;
}

function coverageSummary(hazard: HazardId, profiles: SourceCoverageProfile[]) {
  return {
    status: "coverage_catalog",
    hazard,
    hazard_label: HAZARD_LABELS[hazard],
    source_count: profiles.length,
    sources: profiles.map((profile) => ({
      source_id: profile.sourceId,
      integration_status: profile.integrationStatus,
      evidence_role: profile.evidenceRole,
      region: compactText(profile.regionLabel, 80),
      temporal_coverage: compactText(profile.temporalCoverage, 120),
    })),
    coverage_scope: "pipeline_eligibility_not_observation",
    live_sources_queried: false,
    actual_observation_not_established: true,
    next_step: "Use analyze_environmental_hazard for actual place/time evidence.",
  } as const;
}

export function createEnvironmentalCapabilitiesTool(): WebMCP.ModelContextTool {
  return {
    name: CAPABILITIES_TOOL_NAME,
    title: "Get Sky to Porch help and demos",
    description:
      "Use only when an environmental analysis request has no named/implied hazard, or the person explicitly asks for supported features or demos. For a missing hazard, return options, ask which one, and wait. Never use for concrete place+hazard, preflight, or unrelated tasks. Returns supported hazards and ready demo inputs.",
    inputSchema: CAPABILITIES_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (input) => {
      const unexpected = Object.keys(input)[0];
      if (unexpected) {
        return invalidInput(`Unexpected input field: ${unexpected}.`);
      }
      return {
        status: "hazard_catalog",
        hazards: HAZARD_IDS.map((hazard) => ({
          hazard,
          label: HAZARD_LABELS[hazard],
          default_related_hazards: DEFAULT_RELATED_HAZARDS[hazard],
        })),
        concerns: CONCERN_TYPES,
        concern_guidance:
          "Concern is optional. Infer it when explicit; ask only when a broad goal needs it; otherwise use general and proceed.",
        missing_hazard_request:
          "ask_person_to_choose_hazard_and_wait; do_not_analyze_or_guess",
        demo_scenarios: WEBMCP_DEMO_SCENARIOS.map((scenario) => {
          const { start_date: startDate, end_date: endDate, ...analysisInput } =
            scenario.analysisInput;
          return {
            id: scenario.id,
            title: scenario.title,
            analysis_input: {
              ...analysisInput,
              time: startDate === endDate ? startDate : `${startDate}/${endDate}`,
              analysis_scope: "related_context",
              question: compactText(scenario.prompt, 100),
            },
          };
        }),
        default_analysis_scope: "related_context",
        relationship: "related_evidence_for_assessment",
        selection_guidance:
          "Use single_hazard_only when all requested evidence fits one hazard enum; use related_context for related or multiple hazard families.",
        ui_updated: false,
      };
    },
  };
}

export function createGetEnvironmentalSourceCoverageTool(): WebMCP.ModelContextTool {
  return {
    name: GET_COVERAGE_TOOL_NAME,
    title: "Get environmental source coverage",
    description:
      "Use directly for source-region, time-range, or eligibility questions about one hazard; never preflight with the capabilities catalog. Returns checked-in hazard-wide coverage without live requests. Do not call before ordinary analysis. Coverage is pipeline eligibility, never proof of an observation.",
    inputSchema: GET_COVERAGE_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (input) => {
      const unexpected = Object.keys(input).find(
        (key) => key !== "hazard"
      );
      if (unexpected) return invalidInput(`Unexpected input field: ${unexpected}.`);

      const hazard = input.hazard;
      if (typeof hazard !== "string" || !(HAZARD_IDS as readonly string[]).includes(hazard)) {
        return invalidInput(`hazard must be one of: ${HAZARD_IDS.join(", ")}.`);
      }
      const typedHazard = hazard as HazardId;
      const profiles = coverageProfilesForHazard(typedHazard);
      return coverageSummary(typedHazard, profiles);
    },
  };
}
