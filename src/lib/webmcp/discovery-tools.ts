/// <reference types="webmcp-types" />

import { CONCERN_TYPES, HAZARD_IDS, type HazardId } from "@/contracts/common";
import type { SourceCoverageProfile } from "@/contracts/source-coverage";
import {
  HAZARD_LABELS,
  coverageProfilesForHazard,
} from "@/data/source-coverage";
import { WEBMCP_DEMO_SCENARIOS } from "@/data/places/demo-stories";
import { DEFAULT_RELATED_HAZARDS } from "@/lib/webmcp/analyze-tool";

export const LIST_HAZARDS_TOOL_NAME = "list_environmental_hazards";
export const GET_COVERAGE_TOOL_NAME = "get_environmental_source_coverage";
export const MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS = 2_400;

export const LIST_HAZARDS_INPUT_SCHEMA = {
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

export function createListEnvironmentalHazardsTool(): WebMCP.ModelContextTool {
  return {
    name: LIST_HAZARDS_TOOL_NAME,
    title: "List environmental hazards",
    description:
      "List supported hazards and three curated demos with ready analysis inputs. Use for capability questions, genuine hazard ambiguity, or when the person asks for a demo. It takes no input. Concrete place-and-hazard questions always go directly to analyze_environmental_hazard, even when the place also appears in a demo.",
    inputSchema: LIST_HAZARDS_INPUT_SCHEMA,
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
        demo_scenarios: WEBMCP_DEMO_SCENARIOS.map((scenario) => ({
          id: scenario.id,
          title: scenario.title,
          analysis_input: {
            ...scenario.analysisInput,
            analysis_scope: "related_context",
            question: compactText(scenario.prompt, 120),
          },
        })),
        default_analysis_scope: "related_context",
        relationship: "related_evidence_for_assessment",
        selection_guidance:
          "Use single_hazard_only only when the person explicitly restricts the question to one hazard.",
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
      "Read all checked-in source regions and time ranges for one hazard without live requests. It always returns the hazard-wide catalog and takes only hazard. Do not call before every analysis. Coverage is pipeline eligibility, never proof of an observation.",
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
