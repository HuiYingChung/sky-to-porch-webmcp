/// <reference types="webmcp-types" />

import { CONCERN_TYPES, HAZARD_IDS, type HazardId } from "@/contracts/common";
import type { SourceCoverageProfile } from "@/contracts/source-coverage";
import {
  HAZARD_LABELS,
  SOURCE_COVERAGE_PROFILES,
  coverageProfileRegistryEntry,
  coverageProfilesForHazard,
} from "@/data/source-coverage";
import { DEFAULT_RELATED_HAZARDS } from "@/lib/webmcp/analyze-tool";

export const LIST_HAZARDS_TOOL_NAME = "list_environmental_hazards";
export const GET_COVERAGE_TOOL_NAME = "get_environmental_source_coverage";
export const MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS = 1_500;

const SOURCE_IDS = [...new Set(SOURCE_COVERAGE_PROFILES.map((profile) => profile.sourceId))];

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
    source_id: {
      type: "string",
      enum: SOURCE_IDS,
      description: "Optional source ID from the summary when one detailed profile is needed.",
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
    no_data_is_not_no_danger: true,
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
    })),
    coverage_scope: "pipeline_eligibility_not_observation",
    live_sources_queried: false,
    actual_observation_not_established: true,
    next_step: "Use analyze_environmental_hazard for actual place/time evidence.",
    no_data_is_not_no_danger: true,
  } as const;
}

function coverageDetail(hazard: HazardId, profile: SourceCoverageProfile) {
  const registry = coverageProfileRegistryEntry(profile.sourceId);
  return {
    status: "coverage_profile",
    hazard,
    hazard_label: HAZARD_LABELS[hazard],
    source: {
      source_id: profile.sourceId,
      display_name: compactText(registry?.displayName ?? profile.sourceId, 70),
      integration_status: profile.integrationStatus,
      evidence_role: profile.evidenceRole,
      coverage_level: profile.level,
      region: compactText(profile.regionLabel, 100),
      country_codes: profile.countryCodes,
      temporal_coverage: compactText(profile.temporalCoverage, 150),
      update_cadence: compactText(profile.updateCadence, 110),
      spatial_resolution: compactText(profile.spatialResolution, 130),
      coverage_note: compactText(profile.coverageNote, 190),
      live_gate_note: compactText(profile.liveGateNote, 190),
      ...(profile.lastVerifiedDate ? { last_verified_date: profile.lastVerifiedDate } : {}),
      ...(registry ? { documentation_url: registry.documentationUrl } : {}),
    },
    coverage_scope: "pipeline_eligibility_not_observation",
    live_sources_queried: false,
    actual_observation_not_established: true,
    no_data_is_not_no_danger: true,
  } as const;
}

export function createListEnvironmentalHazardsTool(): WebMCP.ModelContextTool {
  return {
    name: LIST_HAZARDS_TOOL_NAME,
    title: "List environmental hazards",
    description:
      "List Sky to Porch hazard IDs, user concerns, and default related-context companions. Use only when the person asks what the site supports or the hazard is genuinely ambiguous. For a concrete place-and-hazard question, call analyze_environmental_hazard directly.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (input) => {
      if (Object.keys(input).length > 0) {
        return invalidInput("This tool takes no input.");
      }
      return {
        status: "hazard_catalog",
        hazards: HAZARD_IDS.map((hazard) => ({
          hazard,
          label: HAZARD_LABELS[hazard],
          default_related_hazards: DEFAULT_RELATED_HAZARDS[hazard],
        })),
        concerns: CONCERN_TYPES,
        default_analysis_scope: "related_context",
        relationship: "co_occurring_context_not_causation",
        selection_guidance:
          "Use single_hazard_only only when the person explicitly restricts the question to one hazard.",
        ui_updated: false,
        no_data_is_not_no_danger: true,
      };
    },
  };
}

export function createGetEnvironmentalSourceCoverageTool(): WebMCP.ModelContextTool {
  return {
    name: GET_COVERAGE_TOOL_NAME,
    title: "Get environmental source coverage",
    description:
      "Read the checked-in source-coverage catalog for one hazard without making live requests. Use for capability, region, or time-range questions, not before every analysis. Coverage means pipeline eligibility only; it never proves an observation exists for a place or date.",
    inputSchema: GET_COVERAGE_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (input) => {
      const unexpected = Object.keys(input).find(
        (key) => key !== "hazard" && key !== "source_id"
      );
      if (unexpected) return invalidInput(`Unexpected input field: ${unexpected}.`);

      const hazard = input.hazard;
      if (typeof hazard !== "string" || !(HAZARD_IDS as readonly string[]).includes(hazard)) {
        return invalidInput(`hazard must be one of: ${HAZARD_IDS.join(", ")}.`);
      }
      const typedHazard = hazard as HazardId;
      const profiles = coverageProfilesForHazard(typedHazard);
      const sourceId = input.source_id;
      if (sourceId === undefined) {
        return coverageSummary(typedHazard, profiles);
      }
      if (typeof sourceId !== "string") {
        return invalidInput("source_id must be a supported source ID.");
      }
      const profile = profiles.find((item) => item.sourceId === sourceId);
      if (!profile) {
        return invalidInput(`source_id ${sourceId} is not registered for hazard ${typedHazard}.`);
      }
      return coverageDetail(typedHazard, profile);
    },
  };
}
