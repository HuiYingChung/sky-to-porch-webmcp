/// <reference types="webmcp-types" />

import { HAZARD_IDS, type HazardId } from "@/contracts/common";
import type { EvidenceObject, Observation } from "@/contracts/evidence";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import type { StormQueryResult } from "@/lib/storm/types";
import { publicSourceUrl } from "@/data/public-source-links";
import {
  formatUtcTimestamp,
  publicNarrativeText,
  publicUnitName,
  publicVariableName,
} from "@/lib/ui/public-presentation";
import {
  ANSWER_ORDER,
  evidenceScopeForHazard,
  hazardNameForOutput,
  orderedEvidenceObservations,
  resultStatusNameForOutput,
  sourceNameForOutput,
} from "@/lib/webmcp/analyze-tool";

export const INSPECT_EVIDENCE_TOOL_NAME = "inspect_current_environmental_evidence";
export const PREPARE_STORM_CLAIM_TOOL_NAME = "prepare_storm_claim_discussion";
export const MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS = 2_400;
export const INSPECT_EVIDENCE_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    focus: {
      type: "string",
      enum: ["summary", "direct_observations", "sources", "limitations", "evidence_needed"],
      default: "summary",
      description: "Use a focused view for natural follow-ups such as what was observed, which source failed, why the result is inconclusive, or what evidence would change it.",
    },
    hazard: {
      type: "string",
      enum: HAZARD_IDS,
      description: "Optional: inspect only one hazard chain already present in the current Agent result. This never re-runs a query.",
    },
  },
} as const;
export const PREPARE_STORM_CLAIM_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

export interface ContextualToolState {
  activeAnalysis: ActiveAnalysis | null;
  relatedAnalyses: readonly ActiveAnalysis[];
  onOpenStormClaimDiscussion: () => void;
}

export type ReadContextualToolState = () => ContextualToolState;

const FOCUS_NAMES = {
  summary: "Summary",
  direct_observations: "Direct observations",
  sources: "Sources and citations",
  limitations: "Limitations",
  evidence_needed: "Evidence that would change the conclusion",
} as const;

const PLAIN_LANGUAGE_RESPONSE_CONTRACT = {
  style: "plain_english" as const,
  use_display_summary_labels_and_source_name: true as const,
  never_repeat_internal_ids_source_keys_or_enum_names: true as const,
};

function contextStatusName(status: string): string {
  return ({
    ok: "Information available",
    no_evidence: "No information available",
    invalid_input: "Request could not be used",
    no_active_analysis: "No completed analysis",
    not_available_for_current_result: "Not available for the current result",
    ready_for_discussion: "Storm claim discussion ready",
  } as Readonly<Record<string, string>>)[status] ?? "Status unavailable";
}

function retrievalStatusName(status: string): string {
  return ({
    complete: "Complete",
    partial: "Partly complete",
    failed: "Unavailable",
    not_attempted: "Not checked",
  } as Readonly<Record<string, string>>)[status] ?? "Status unavailable";
}

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
    name: compactText(publicVariableName(item.variableName), 70),
    value: item.value ?? compactText(publicNarrativeText(item.textValue ?? "Unavailable"), 100),
    unit: item.unit ? compactText(publicUnitName(item.unit), 30) : undefined,
    source_name: sourceNameForOutput(item.provenance.sourceId),
    observed: formatUtcTimestamp(item.provenance.observedAt),
  };
}

function compactCitation(item: Observation, hazard: ActiveAnalysis["request"]["hazardId"]) {
  return {
    hazard,
    hazard_label: hazardNameForOutput(hazard),
    source_name: sourceNameForOutput(item.provenance.sourceId),
    product: compactText(publicNarrativeText(item.provenance.product), 90),
    observed: formatUtcTimestamp(item.provenance.observedAt),
    retrieved: formatUtcTimestamp(item.provenance.retrievedAt),
    url: publicSourceUrl(item.provenance.sourceId),
  };
}

function citationsFor(analysis: ActiveAnalysis, maximum: number) {
  const evidence = evidenceFrom(analysis);
  return evidence ? orderedEvidenceObservations(evidence)
    .filter((item, index, observations) =>
      observations.findIndex((candidate) =>
        candidate.provenance.sourceId === item.provenance.sourceId
      ) === index
    )
    .slice(0, maximum)
    .map((item) => compactCitation(item, analysis.request.hazardId)) : [];
}

function focusedInspection(
  focus: Exclude<typeof INSPECT_EVIDENCE_INPUT_SCHEMA.properties.focus.enum[number], "summary">,
  analysis: ActiveAnalysis
) {
  const evidence = evidenceFrom(analysis);
  const observations = evidence ? orderedEvidenceObservations(evidence) : [];
  const sourceChecks = evidence?.missionAttributions.map((attribution) => ({
    source: compactText(publicNarrativeText(attribution.missionName), 70),
    status: attribution.retrievalStatus,
    status_label: retrievalStatusName(attribution.retrievalStatus),
    limitation: compactText(publicNarrativeText(attribution.keyLimitation), 130),
  })) ?? [];
  const failedLimitations = evidence?.limitations
    .filter((limitation) => /\b(?:failed|failure|partially completed)\b/iu.test(limitation.description))
    .map((limitation) => ({
      source: sourceNameForOutput(limitation.source),
      status: "failed_or_incomplete" as const,
      status_label: "Unavailable or partly complete",
      limitation: compactText(publicNarrativeText(limitation.description), 130),
    })) ?? [];
  const limitations = evidence?.limitations
    .filter((limitation) => limitation.required)
    .slice(0, 5)
    .map((limitation) => compactText(publicNarrativeText(limitation.description), 180)) ?? [];
  const noObservations = observations.length === 0;
  const status = evidence ? "ok" : "no_evidence";
  const hazardLabel = hazardNameForOutput(analysis.request.hazardId);
  const evidenceScope = evidenceScopeForHazard(analysis.request.hazardId);
  const evidenceState = evidence?.evidenceState ?? "unavailable";
  const confidence = evidence?.confidence.level ?? "insufficient";
  const displaySummary = focus === "direct_observations"
    ? `${hazardLabel}: ${observations.length} direct official observation${observations.length === 1 ? "" : "s"} available.`
    : focus === "sources"
      ? `${hazardLabel}: ${sourceChecks.length + failedLimitations.length} official source check${sourceChecks.length + failedLimitations.length === 1 ? "" : "s"}.`
      : focus === "limitations"
        ? `${hazardLabel}: ${limitations.length} required limitation${limitations.length === 1 ? "" : "s"}.`
        : `${hazardLabel}: evidence that could change the conclusion.`;
  const output = {
    status,
    status_label: contextStatusName(status),
    display_summary: displaySummary,
    focus,
    focus_label: FOCUS_NAMES[focus],
    hazard: analysis.request.hazardId,
    hazard_label: hazardLabel,
    evidence_scope: evidenceScope,
    evidence_state: evidenceState,
    confidence,
    ...(focus === "direct_observations"
      ? { direct_observations: observations.slice(0, 5).map(compactObservation) }
      : focus === "sources"
        ? {
            source_checks: [...sourceChecks, ...failedLimitations].slice(0, 8),
            citations: citationsFor(analysis, 5),
          }
        : focus === "limitations"
          ? { limitations }
          : {
              what_would_change_conclusion: [
                ...(noObservations
                  ? ["A direct official observation for this place, time, and selected area."]
                  : []),
                ...(failedLimitations.length > 0
                  ? ["A successful retry of the failed or incomplete official-source check."]
                  : []),
                "A local inspection or official route/property report for address-level conclusions.",
              ].slice(0, 3),
              still_unknown: noObservations
                ? "No direct observation was returned; this does not prove safety or no danger."
                : "Regional observations do not establish property-level impact, route safety, or causation.",
            }),
    agent_response_contract: {
      ...PLAIN_LANGUAGE_RESPONSE_CONTRACT,
      answer_the_follow_up_directly: true,
      distinguish_observation_inference_and_unknown: true,
    },
    ...(noObservations ? { no_data_is_not_no_danger: true as const } : {}),
  };
  if (JSON.stringify(output).length <= MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS) return output;
  return {
    ...output,
    ...(focus === "sources"
      ? {
          source_checks: "source_checks" in output ? output.source_checks.slice(0, 3) : [],
          citations: "citations" in output ? output.citations.slice(0, 2) : [],
        }
      : focus === "limitations"
        ? { limitations: "limitations" in output ? output.limitations.slice(0, 3) : [] }
        : focus === "direct_observations"
          ? {
              direct_observations: "direct_observations" in output
                ? output.direct_observations.slice(0, 2)
                : [],
            }
          : {}),
  };
}

function createInspectEvidenceToolFromState(
  readState: () => Pick<ContextualToolState, "activeAnalysis" | "relatedAnalyses">
): WebMCP.ModelContextTool {
  return {
    name: INSPECT_EVIDENCE_TOOL_NAME,
    title: "Inspect current environmental evidence",
    description:
      "Use only after an environmental analysis. Read validated observations, confidence, and citations from the current primary and related evidence without re-querying or controlling the UI. If no result is active, this says so. Answer with display_summary, display labels, and source_name; never expose observation IDs, source keys, field names, or enum names. Explain supported relationships and label inference. Do not use for an insurer or property-record checklist; use the storm claim discussion tool when applicable.",
    inputSchema: INSPECT_EVIDENCE_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => {
      const unexpected = Object.keys(input).find((key) => key !== "focus" && key !== "hazard");
      if (unexpected) {
        return {
          status: "invalid_input",
          status_label: contextStatusName("invalid_input"),
          display_summary: "The evidence request could not be used.",
          message: "We couldn’t use this evidence request. Check the requested view and try again.",
          ui_updated: false,
          agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
        };
      }
      const focus = input.focus ?? "summary";
      if (!INSPECT_EVIDENCE_INPUT_SCHEMA.properties.focus.enum.includes(focus as never)) {
        return {
          status: "invalid_input",
          status_label: contextStatusName("invalid_input"),
          display_summary: "The requested evidence view is not supported.",
          message: "That evidence view is not available. Choose another view and try again.",
          ui_updated: false,
          agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
        };
      }
      if (
        input.hazard !== undefined &&
        (typeof input.hazard !== "string" || !(HAZARD_IDS as readonly string[]).includes(input.hazard))
      ) {
        return {
          status: "invalid_input",
          status_label: contextStatusName("invalid_input"),
          display_summary: "The requested hazard is not supported.",
          message: "That environmental topic is not available in this result.",
          ui_updated: false,
          agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
        };
      }
      const { activeAnalysis: analysis, relatedAnalyses } = readState();
      if (!analysis) {
        return {
          status: "no_active_analysis",
          status_label: contextStatusName("no_active_analysis"),
          display_summary: "No completed environmental analysis is available to inspect.",
          ui_updated: false,
          message: "No completed environmental analysis is active. Run an analysis first.",
          agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
        };
      }
      const availableAnalyses = [analysis, ...relatedAnalyses];
      const selectedAnalysis = typeof input.hazard === "string"
        ? availableAnalyses.find((item) => item.request.hazardId === input.hazard as HazardId)
        : analysis;
      if (!selectedAnalysis) {
        return {
          status: "invalid_input",
          status_label: contextStatusName("invalid_input"),
          display_summary: "That hazard is not included in the current environmental result.",
          ui_updated: false,
          message: "That environmental topic is not included in the current result. Run a new check first.",
          agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
        };
      }
      if (focus !== "summary") {
        return focusedInspection(
          focus as Exclude<typeof INSPECT_EVIDENCE_INPUT_SCHEMA.properties.focus.enum[number], "summary">,
          selectedAnalysis
        );
      }
      const evidence = evidenceFrom(selectedAnalysis);
      const allAnalyses = typeof input.hazard === "string"
        ? [selectedAnalysis]
        : availableAnalyses;
      const selectedRelatedAnalyses = allAnalyses.filter(
        (item) => item.analysisId !== selectedAnalysis.analysisId
      );
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
        ...citationsFor(selectedAnalysis, 2),
        ...selectedRelatedAnalyses.flatMap((related) => citationsFor(related, 1)),
      ];
      const status = evidence ? "ok" : "no_evidence";
      const hazardLabel = hazardNameForOutput(selectedAnalysis.request.hazardId);
      const evidenceScope = evidenceScopeForHazard(selectedAnalysis.request.hazardId);
      const displaySummary = chainsWithObservations > 0
        ? `${hazardLabel}: ${chainsWithObservations} of ${allAnalyses.length} evidence chain${allAnalyses.length === 1 ? "" : "s"} returned official observations from ${sourceCount} source${sourceCount === 1 ? "" : "s"}.`
        : `${hazardLabel}: no direct observations were returned; this does not prove safety or no danger.`;
      const output = {
        status,
        status_label: contextStatusName(status),
        display_summary: displaySummary,
        hazard: selectedAnalysis.request.hazardId,
        hazard_label: hazardLabel,
        evidence_scope: evidenceScope,
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
        ...(selectedRelatedAnalyses.length > 0
          ? {
              relationship: "related_evidence_for_assessment" as const,
              inference_guidance: "state_strongest_supported_inference_and_confidence" as const,
              related_chains: selectedRelatedAnalyses.map((related) => ({
                hazard: related.request.hazardId,
                hazard_label: hazardNameForOutput(related.request.hazardId),
                status: (related.outcome.result as { kind: string }).kind,
                status_label: resultStatusNameForOutput(
                  (related.outcome.result as { kind: string }).kind
                ),
                evidence_scope: evidenceScopeForHazard(related.request.hazardId),
                confidence: evidenceFrom(related)?.confidence.level ?? "insufficient",
                observation_count: evidenceFrom(related)?.observations.length ?? 0,
                strongest_observation: evidenceFrom(related)?.observations[0]
                  ? compactObservation(evidenceFrom(related)!.observations[0])
                  : null,
              })),
            }
          : {}),
        source_names: evidence
          ? [...new Set(evidence.observations.map(
              (item) => sourceNameForOutput(item.provenance.sourceId)
            ))]
          : [],
        observations: evidence ? orderedEvidenceObservations(evidence).slice(0, 3).map(compactObservation) : [],
        citations,
        limitations: evidence?.limitations
          .filter((item) => item.required)
          .slice(0, 2)
          .map((item) => compactText(publicNarrativeText(item.description), 150)) ?? [],
        agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
        ...(chainsWithObservations === 0 ? { no_data_is_not_no_danger: true as const } : {}),
      };
      if (JSON.stringify(output).length <= MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS) return output;
      const reduced = {
        ...output,
        observations: output.observations.slice(0, 1),
        limitations: output.limitations.slice(0, 1),
        citations: output.citations.filter((citation, index, all) =>
          all.findIndex((candidate) => candidate.hazard === citation.hazard) === index
        ),
      };
      if (JSON.stringify(reduced).length <= MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS) return reduced;

      const compact = {
        ...reduced,
        citations: reduced.citations.map((citation) => ({
          hazard: citation.hazard,
          hazard_label: citation.hazard_label,
          source_name: citation.source_name,
          observed: citation.observed,
          url: null,
        })),
        related_chains: reduced.related_chains?.map((chain) => ({
          hazard: chain.hazard,
          hazard_label: chain.hazard_label,
          status: chain.status,
          status_label: chain.status_label,
          evidence_scope: chain.evidence_scope,
          confidence: chain.confidence,
          observation_count: chain.observation_count,
          strongest_observation: chain.strongest_observation,
        })),
      };
      if (JSON.stringify(compact).length <= MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS) return compact;

      const minimal = {
        status: compact.status,
        status_label: compact.status_label,
        display_summary: compact.display_summary,
        hazard: compact.hazard,
        hazard_label: compact.hazard_label,
        evidence_scope: compact.evidence_scope,
        support: compact.support,
        answer_order: compact.answer_order,
        agent_response_contract: compact.agent_response_contract,
        ...(compact.relationship ? { relationship: compact.relationship } : {}),
        ...(compact.inference_guidance
          ? { inference_guidance: compact.inference_guidance }
          : {}),
        source_names: compact.source_names.slice(0, 4),
        observations: compact.observations.slice(0, 1),
        citations: compact.citations.slice(0, 2),
        limitations: compact.limitations
          .slice(0, 1)
          .map((item) => compactText(item, 100)),
        ...(compact.related_chains && compact.related_chains.length > 0
          ? {
              related_chains: compact.related_chains.map((chain) => ({
                hazard: chain.hazard,
                hazard_label: chain.hazard_label,
                status: chain.status,
                status_label: chain.status_label,
                evidence_scope: chain.evidence_scope,
                confidence: chain.confidence,
                observation_count: chain.observation_count,
                strongest_observation: chain.strongest_observation,
              })),
            }
          : {}),
        ...(compact.no_data_is_not_no_danger
          ? { no_data_is_not_no_danger: true as const }
          : {}),
      };
      if (JSON.stringify(minimal).length <= MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS) return minimal;
      return {
        status: minimal.status,
        status_label: minimal.status_label,
        display_summary: minimal.display_summary,
        hazard: minimal.hazard,
        hazard_label: minimal.hazard_label,
        evidence_scope: minimal.evidence_scope,
        support: minimal.support,
        agent_response_contract: minimal.agent_response_contract,
        ...(minimal.relationship ? { relationship: minimal.relationship } : {}),
        ...(minimal.inference_guidance
          ? { inference_guidance: minimal.inference_guidance }
          : {}),
        observations: minimal.observations.slice(0, 1),
        citations: minimal.citations.slice(0, 2),
        ...(minimal.related_chains
          ? {
              related_chains: minimal.related_chains.map((chain) => ({
                hazard: chain.hazard,
                hazard_label: chain.hazard_label,
                status: chain.status,
                status_label: chain.status_label,
                observation_count: chain.observation_count,
                strongest_observation: chain.strongest_observation,
              })),
            }
          : {}),
        ...(minimal.no_data_is_not_no_danger
          ? { no_data_is_not_no_danger: true as const }
          : {}),
      };
    },
  };
}

export function createInspectEvidenceTool(
  analysis: ActiveAnalysis,
  relatedAnalyses: readonly ActiveAnalysis[] = []
): WebMCP.ModelContextTool {
  return createInspectEvidenceToolFromState(() => ({
    activeAnalysis: analysis,
    relatedAnalyses,
  }));
}

export function createStateBackedInspectEvidenceTool(
  readState: ReadContextualToolState
): WebMCP.ModelContextTool {
  return createInspectEvidenceToolFromState(readState);
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

function createStormClaimDiscussionToolFromState(
  readState: ReadContextualToolState
): WebMCP.ModelContextTool {
  return {
    name: PREPARE_STORM_CLAIM_TOOL_NAME,
    title: "Prepare a storm claim discussion",
    description:
      "Use only when the current completed result is Home + Wind & Storm and the person asks to open an insurer discussion or identify roof/property records. Otherwise this returns a non-applicable status. It opens the evidence-backed wind contribution kit, leads with supported regional findings, and shows records that could strengthen the discussion; the insurer decides coverage. Use display labels and summaries; never expose internal IDs, field names, or enum names.",
    inputSchema: PREPARE_STORM_CLAIM_INPUT_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input) => {
      if (Object.keys(input).length > 0) {
        return {
          status: "invalid_input",
          status_label: contextStatusName("invalid_input"),
          display_summary: "The storm claim discussion request could not be used.",
          ui_updated: false,
          message: "Open this discussion without adding extra details, then try again.",
          agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
        };
      }
      const {
        activeAnalysis: analysis,
        onOpenStormClaimDiscussion: onOpen,
      } = readState();
      if (!analysis) {
        return {
          status: "no_active_analysis",
          status_label: contextStatusName("no_active_analysis"),
          display_summary: "No completed environmental analysis is available for a storm claim discussion.",
          ui_updated: false,
          message: "No completed environmental analysis is active. Run an analysis first.",
          agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
        };
      }
      const discussion = claimDiscussionForAnalysis(analysis);
      if (!discussion) {
        return {
          status: "not_available_for_current_result",
          status_label: contextStatusName("not_available_for_current_result"),
          display_summary: "A storm claim discussion is not available for the current result.",
          ui_updated: false,
          message: "This action requires a completed Home + Wind & Storm result with a claim discussion guide.",
          agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
        };
      }
      onOpen();
      const output = {
        status: "ready_for_discussion",
        status_label: contextStatusName("ready_for_discussion"),
        display_summary: compactText(
          publicNarrativeText(discussion.assessmentSummary),
          220
        ),
        ui_updated: true,
        hazard: "wind_storm" as const,
        hazard_label: hazardNameForOutput("wind_storm"),
        evidence_scope: "regional_wind_observations",
        assessment: publicNarrativeText(discussion.assessmentSummary),
        confidence: discussion.assessmentConfidence,
        supported_by_evidence: discussion.supportedStatements
          .slice(0, 2)
          .map((item) => compactText(publicNarrativeText(item), 150)),
        property_specific_questions: discussion.notEstablished
          .slice(0, 3)
          .map((item) => compactText(publicNarrativeText(item), 130)),
        documentation_checklist: discussion.documentationChecklist
          .slice(0, 4)
          .map((item) => compactText(publicNarrativeText(item), 140)),
        official_guidance_urls: discussion.officialGuidance.map((item) => item.url),
        no_claim_decision: true,
        agent_response_contract: PLAIN_LANGUAGE_RESPONSE_CONTRACT,
      };
      if (JSON.stringify(output).length <= MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS) return output;
      const reduced = {
        ...output,
        supported_by_evidence: output.supported_by_evidence.slice(0, 1),
        property_specific_questions: output.property_specific_questions.slice(0, 2),
        documentation_checklist: output.documentation_checklist.slice(0, 2),
        official_guidance_urls: output.official_guidance_urls.slice(0, 1),
      };
      if (JSON.stringify(reduced).length <= MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS) return reduced;
      return {
        status: reduced.status,
        status_label: reduced.status_label,
        display_summary: reduced.display_summary,
        ui_updated: reduced.ui_updated,
        hazard: reduced.hazard,
        hazard_label: reduced.hazard_label,
        evidence_scope: reduced.evidence_scope,
        assessment: compactText(reduced.assessment, 200),
        confidence: reduced.confidence,
        supported_by_evidence: reduced.supported_by_evidence
          .slice(0, 1)
          .map((item) => compactText(item, 100)),
        property_specific_questions: reduced.property_specific_questions
          .slice(0, 1)
          .map((item) => compactText(item, 100)),
        documentation_checklist: reduced.documentation_checklist
          .slice(0, 1)
          .map((item) => compactText(item, 100)),
        official_guidance_urls: reduced.official_guidance_urls
          .filter((url) => url.length <= 500)
          .slice(0, 1),
        no_claim_decision: true,
        agent_response_contract: reduced.agent_response_contract,
      };
    },
  };
}

export function createStormClaimDiscussionTool(
  analysis: ActiveAnalysis,
  onOpen: () => void
): WebMCP.ModelContextTool | null {
  if (!claimDiscussionForAnalysis(analysis)) return null;
  return createStormClaimDiscussionToolFromState(() => ({
    activeAnalysis: analysis,
    relatedAnalyses: [],
    onOpenStormClaimDiscussion: onOpen,
  }));
}

export function createStateBackedStormClaimDiscussionTool(
  readState: ReadContextualToolState
): WebMCP.ModelContextTool {
  return createStormClaimDiscussionToolFromState(readState);
}
