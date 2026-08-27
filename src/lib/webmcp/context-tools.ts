/// <reference types="webmcp-types" />

import type { EvidenceObject, Observation } from "@/contracts/evidence";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import type { StormQueryResult } from "@/lib/storm/types";
import { ANSWER_ORDER, evidenceScopeForHazard } from "@/lib/webmcp/analyze-tool";

export const INSPECT_EVIDENCE_TOOL_NAME = "inspect_current_environmental_evidence";
export const PREPARE_STORM_CLAIM_TOOL_NAME = "prepare_storm_claim_discussion";
export const MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS = 2_400;
export const INSPECT_EVIDENCE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;
export const PREPARE_STORM_CLAIM_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

function compactText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

function evidenceFrom(analysis: ActiveAnalysis): EvidenceObject | null {
  const result = analysis.outcome.result as { evidence?: EvidenceObject };
  return result.evidence ?? null;
}

function compactObservation(item: Observation) {
  return {
    id: item.observationId,
    name: compactText(item.variableName, 70),
    value: item.value ?? compactText(item.textValue ?? "unavailable", 100),
    unit: item.unit,
    source: item.provenance.sourceId,
    observed_at: item.provenance.observedAt,
  };
}

function compactCitation(item: Observation, hazard: ActiveAnalysis["request"]["hazardId"]) {
  const sourceUrl = item.provenance.sourceUrl;
  return {
    hazard,
    source: item.provenance.sourceId,
    product: compactText(item.provenance.product, 90),
    observed_at: item.provenance.observedAt,
    retrieved_at: item.provenance.retrievedAt,
    url: typeof sourceUrl === "string" && sourceUrl.length <= 500 ? sourceUrl : null,
  };
}

function citationsFor(analysis: ActiveAnalysis, maximum: number) {
  const evidence = evidenceFrom(analysis);
  return evidence?.observations
    .filter((item, index, observations) =>
      observations.findIndex((candidate) =>
        candidate.provenance.sourceId === item.provenance.sourceId
      ) === index
    )
    .slice(0, maximum)
    .map((item) => compactCitation(item, analysis.request.hazardId)) ?? [];
}

export function createInspectEvidenceTool(
  analysis: ActiveAnalysis,
  relatedAnalyses: ActiveAnalysis[] = []
): WebMCP.ModelContextTool {
  return {
    name: INSPECT_EVIDENCE_TOOL_NAME,
    title: "Inspect current environmental evidence",
    description:
      "Read the strongest validated observations, confidence, and structured citations from the primary result and related evidence currently shown in Sky to Porch. It does not re-query sources or control the interface. Explain the strongest relationship the returned evidence supports and label inference separately from direct observation.",
    inputSchema: INSPECT_EVIDENCE_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => {
      if (Object.keys(input).length > 0) {
        return { status: "invalid_input", message: "This tool takes no input." };
      }
      const evidence = evidenceFrom(analysis);
      const allAnalyses = [analysis, ...relatedAnalyses];
      const chainsWithObservations = allAnalyses.filter(
        (item) => (evidenceFrom(item)?.observations.length ?? 0) > 0
      ).length;
      const sourceCount = new Set(allAnalyses.flatMap(
        (item) => evidenceFrom(item)?.observations.map(
          (observation) => observation.provenance.sourceId
        ) ?? []
      )).size;
      const assessmentConfidence = chainsWithObservations === allAnalyses.length && sourceCount >= 4
        ? "moderate" as const
        : chainsWithObservations >= 2 && sourceCount >= 2
          ? "low" as const
          : "insufficient" as const;
      const citations = [
        ...citationsFor(analysis, 2),
        ...relatedAnalyses.flatMap((related) => citationsFor(related, 1)),
      ];
      const output = {
        status: evidence ? "ok" : "no_evidence",
        analysis_id: analysis.analysisId,
        hazard: analysis.request.hazardId,
        evidence_scope: evidenceScopeForHazard(analysis.request.hazardId),
        support: {
          level: chainsWithObservations === allAnalyses.length
            ? "official_observations_in_every_chain"
            : chainsWithObservations > 0
              ? "partial_official_context"
              : "no_observations_returned",
          confidence: evidence?.confidence.level ?? "insufficient",
          assessment_confidence: assessmentConfidence,
          chains_with_observations: chainsWithObservations,
          total_chains: allAnalyses.length,
          source_count: sourceCount,
        },
        answer_order: ANSWER_ORDER,
        ...(relatedAnalyses.length > 0
          ? {
              relationship: "related_evidence_for_assessment" as const,
              inference_guidance: "state_strongest_supported_inference_and_confidence" as const,
              related_chains: relatedAnalyses.map((related) => ({
                hazard: related.request.hazardId,
                status: (related.outcome.result as { kind: string }).kind,
                evidence_scope: evidenceScopeForHazard(related.request.hazardId),
                confidence: evidenceFrom(related)?.confidence.level ?? "insufficient",
                observation_count: evidenceFrom(related)?.observations.length ?? 0,
                strongest_observation: evidenceFrom(related)?.observations[0]
                  ? compactObservation(evidenceFrom(related)!.observations[0])
                  : null,
              })),
            }
          : {}),
        sources: evidence
          ? [...new Set(evidence.observations.map((item) => item.provenance.sourceId))]
          : [],
        observations: evidence?.observations.slice(0, 3).map(compactObservation) ?? [],
        citations,
        limitations: evidence?.limitations
          .filter((item) => item.required)
          .slice(0, 2)
          .map((item) => compactText(item.description, 150)) ?? [],
        ...(chainsWithObservations === 0 ? { no_data_is_not_no_danger: true as const } : {}),
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
      "Open an evidence-backed kit for discussing possible wind contribution to roof or home damage with an insurer. Available after a Home + Wind & Storm result. It leads with supported regional findings and shows which property-specific records would strengthen the discussion; the insurer makes the coverage decision.",
    inputSchema: PREPARE_STORM_CLAIM_INPUT_SCHEMA,
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
        evidence_scope: "regional_wind_observations",
        assessment: discussion.assessmentSummary,
        confidence: discussion.assessmentConfidence,
        supported_by_evidence: discussion.supportedStatements
          .slice(0, 2)
          .map((item) => compactText(item, 150)),
        property_specific_questions: discussion.notEstablished
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
        property_specific_questions: output.property_specific_questions.slice(0, 2),
        documentation_checklist: output.documentation_checklist.slice(0, 2),
        official_guidance_urls: output.official_guidance_urls.slice(0, 1),
      };
    },
  };
}
