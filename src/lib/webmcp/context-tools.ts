/// <reference types="webmcp-types" />

import type { EvidenceObject } from "@/contracts/evidence";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import type { StormQueryResult } from "@/lib/storm/types";
import { evidenceScopeForHazard } from "@/lib/webmcp/analyze-tool";

export const INSPECT_EVIDENCE_TOOL_NAME = "inspect_current_environmental_evidence";
export const PREPARE_STORM_CLAIM_TOOL_NAME = "prepare_storm_claim_discussion";
export const MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS = 1_500;

function compactText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

function evidenceFrom(analysis: ActiveAnalysis): EvidenceObject | null {
  const result = analysis.outcome.result as { evidence?: EvidenceObject };
  return result.evidence ?? null;
}

export function createInspectEvidenceTool(
  analysis: ActiveAnalysis,
  relatedAnalyses: ActiveAnalysis[] = []
): WebMCP.ModelContextTool {
  return {
    name: INSPECT_EVIDENCE_TOOL_NAME,
    title: "Inspect current environmental evidence",
    description:
      "Read the validated primary result and any separate related-context chains currently shown in Sky to Porch. It does not run another query or merge cross-hazard causation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => {
      if (Object.keys(input).length > 0) {
        return { status: "invalid_input", message: "This tool takes no input." };
      }
      const evidence = evidenceFrom(analysis);
      const output = {
        status: evidence ? "ok" : "no_evidence",
        analysis_id: analysis.analysisId,
        hazard: analysis.request.hazardId,
        evidence_scope: evidenceScopeForHazard(analysis.request.hazardId),
        ...(relatedAnalyses.length > 0
          ? {
              relationship: "co_occurring_context_not_causation" as const,
              related_chains: relatedAnalyses.map((related) => ({
                hazard: related.request.hazardId,
                status: (related.outcome.result as { kind: string }).kind,
                evidence_scope: evidenceScopeForHazard(related.request.hazardId),
              })),
            }
          : {}),
        sources: evidence
          ? [...new Set(evidence.observations.map((item) => item.provenance.sourceId))]
          : [],
        observations: evidence?.observations.slice(0, 3).map((item) => ({
          id: item.observationId,
          name: compactText(item.variableName, 70),
          value: item.value ?? compactText(item.textValue ?? "unavailable", 100),
          unit: item.unit,
          source: item.provenance.sourceId,
          observed_at: item.provenance.observedAt,
        })) ?? [],
        limitations: evidence?.limitations
          .filter((item) => item.required)
          .slice(0, 3)
          .map((item) => compactText(item.description, 150)) ?? [],
        no_data_is_not_no_danger: true,
      };
      if (JSON.stringify(output).length <= MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS) return output;
      return {
        ...output,
        observations: output.observations.slice(0, 1),
        limitations: output.limitations.slice(0, 1),
      };
    },
  };
}

export function claimDiscussionForAnalysis(
  analysis: ActiveAnalysis
): StormQueryResult["claimDiscussion"] | null {
  if (
    analysis.outcome.hazardId !== "wind_storm" ||
    analysis.request.concern !== "home"
  ) return null;
  return analysis.outcome.result.claimDiscussion ?? null;
}

export function createStormClaimDiscussionTool(
  analysis: ActiveAnalysis,
  onOpen: () => void
): WebMCP.ModelContextTool | null {
  const discussion = claimDiscussionForAnalysis(analysis);
  if (!discussion) return null;
  return {
    name: PREPARE_STORM_CLAIM_TOOL_NAME,
    title: "Prepare a storm claim discussion",
    description:
      "Open a bounded checklist for discussing possible wind damage with an insurer. Available only after a Home + Wind & Storm result. It never decides causation, coverage, liability, repair scope, or claim outcome.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input) => {
      if (Object.keys(input).length > 0) {
        return { status: "invalid_input", ui_updated: false, message: "This tool takes no input." };
      }
      onOpen();
      const output = {
        status: "ready_for_discussion",
        ui_updated: true,
        analysis_id: analysis.analysisId,
        evidence_scope: "wind_only_no_rain_flood_or_water_gages",
        supported_by_evidence: discussion.supportedStatements
          .slice(0, 2)
          .map((item) => compactText(item, 150)),
        not_established: discussion.notEstablished
          .slice(0, 3)
          .map((item) => compactText(item, 130)),
        documentation_checklist: discussion.documentationChecklist
          .slice(0, 4)
          .map((item) => compactText(item, 140)),
        official_guidance_urls: discussion.officialGuidance.map((item) => item.url),
        no_claim_decision: true,
      };
      if (JSON.stringify(output).length <= MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS) return output;
      return {
        ...output,
        supported_by_evidence: output.supported_by_evidence.slice(0, 1),
        not_established: output.not_established.slice(0, 2),
        documentation_checklist: output.documentation_checklist.slice(0, 2),
        official_guidance_urls: output.official_guidance_urls.slice(0, 1),
      };
    },
  };
}
