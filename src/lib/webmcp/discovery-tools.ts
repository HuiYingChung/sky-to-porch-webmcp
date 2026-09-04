/// <reference types="webmcp-types" />

import { HAZARD_IDS, type HazardId } from "@/contracts/common";
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

const DISCOVERY_RESPONSE_CONTRACT = {
  style: "plain_english" as const,
  use_display_fields: true as const,
  never_repeat_internal_names: true as const,
};

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

function invalidInput(_message: string) {
  void _message;
  return {
    status: "invalid_input",
    status_label: "Request could not be used",
    display_summary: "The discovery request could not be used.",
    message: "We couldn’t use this request. Check the requested topic and try again.",
    ui_updated: false,
    agent_response_contract: DISCOVERY_RESPONSE_CONTRACT,
  } as const;
}

function availabilityLabel(
  status: SourceCoverageProfile["integrationStatus"]
): string {
  return ({
    live_integrated: "Ready now",
    live_key_required: "Needs setup",
    prepared_for_live: "Not ready yet",
    registered_deferred: "Not available",
    supporting_only: "Background context only",
  } satisfies Record<SourceCoverageProfile["integrationStatus"], string>)[status];
}

function coverageSummary(hazard: HazardId, profiles: SourceCoverageProfile[]) {
  const output = {
    status: "coverage_catalog",
    status_label: "Environmental source coverage",
    display_summary: `${HAZARD_LABELS[hazard]}: ${profiles.length} registered sources. Availability does not establish an observation.`,
    hazard_label: HAZARD_LABELS[hazard],
    source_count: profiles.length,
    sources: profiles.map((profile) => ({
      source_name: profile.publicName,
      availability: availabilityLabel(profile.integrationStatus),
      region: compactText(profile.regionLabel, 48),
      time_range: compactText(profile.temporalCoverage, 80),
    })),
    guidance: "Availability describes source coverage, not an observation for a particular place and date.",
    agent_response_contract: DISCOVERY_RESPONSE_CONTRACT,
  } as const;
  if (JSON.stringify(output).length <= MAX_DISCOVERY_TOOL_OUTPUT_CHARACTERS) {
    return output;
  }
  return {
    ...output,
    display_summary: `${HAZARD_LABELS[hazard]}: ${profiles.length} sources; availability is not an observation.`,
    sources: profiles.map((profile) => ({
      source_name: profile.publicName,
      availability: availabilityLabel(profile.integrationStatus),
      region: compactText(profile.regionLabel, 32),
      time_range: compactText(profile.temporalCoverage, 54),
    })),
  } as const;
}

export function createEnvironmentalCapabilitiesTool(): WebMCP.ModelContextTool {
  return {
    name: CAPABILITIES_TOOL_NAME,
    title: "Get Sky to Porch help and demos",
    description:
      "Use only when an environmental analysis request has no named/implied hazard, or the person explicitly asks for supported features or demos. For a missing hazard, return options, ask which one, and wait. Never use for concrete place+hazard, preflight, or unrelated tasks. Use display summaries and labels; never expose field names or enum names.",
    inputSchema: CAPABILITIES_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (input) => {
      const unexpected = Object.keys(input)[0];
      if (unexpected) {
        return invalidInput(`Unexpected input field: ${unexpected}.`);
      }
      return {
        status: "hazard_catalog",
        status_label: "Supported environmental hazards",
        display_summary: "Seven environmental hazard groups are available.",
        hazards: HAZARD_IDS.map((hazard) => ({
          label: HAZARD_LABELS[hazard],
          tool_input: {
            hazard,
            related_hazards: DEFAULT_RELATED_HAZARDS[hazard],
          },
        })),
        missing_hazard_guidance:
          "Ask which hazard they mean, then wait.",
        demo_scenarios: WEBMCP_DEMO_SCENARIOS.map((scenario) => {
          const { start_date: startDate, end_date: endDate, ...analysisInput } =
            scenario.analysisInput;
          return {
            title: scenario.title,
            tool_input: {
              ...analysisInput,
              time: startDate === endDate ? startDate : `${startDate}/${endDate}`,
              analysis_scope: "related_context",
              question: compactText(scenario.prompt, 35),
            },
          };
        }),
        selection_guidance:
          "Use one chain for a narrow request; include related context for broader requests.",
        ui_updated: false,
        agent_response_contract: DISCOVERY_RESPONSE_CONTRACT,
      };
    },
  };
}

export function createGetEnvironmentalSourceCoverageTool(): WebMCP.ModelContextTool {
  return {
    name: GET_COVERAGE_TOOL_NAME,
    title: "Get environmental source coverage",
    description:
      "Use directly for source-region, time-range, or eligibility questions about one hazard; never preflight with the capabilities catalog. Returns checked-in hazard-wide coverage without live requests. Do not call before ordinary analysis. Coverage is eligibility, never proof of an observation. Answer with source_name, availability, and display labels; never expose source keys, field names, or enum names.",
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
