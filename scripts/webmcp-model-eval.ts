import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { ActiveAnalysis, AnalysisRequest } from "@/lib/analysis/types";
import {
  applyEnvironmentalMapDesiredState,
  createInitialEnvironmentalMapState,
  sameMapSelection,
} from "@/lib/map/environmental-map-state";
import type { PlaceSelection } from "@/lib/location/selection";
import {
  createAnalyzeHazardTool,
  createCompareHazardTool,
  DEFAULT_RELATED_HAZARDS,
} from "@/lib/webmcp/analyze-tool";
import {
  createStateBackedInspectEvidenceTool,
  createStateBackedStormClaimDiscussionTool,
} from "@/lib/webmcp/context-tools";
import {
  createGetEnvironmentalSourceCoverageTool,
  createEnvironmentalCapabilitiesTool,
} from "@/lib/webmcp/discovery-tools";
import { createSetEnvironmentalMapLayersTool } from "@/lib/webmcp/map-tool";
import { createLookUpPlaceLocationTool } from "@/lib/webmcp/place-tool";
import {
  asksUserToChooseHazard,
  normalizeEvalPlace,
  preservesNoObservationBoundary,
  scoreMultiChainPlainEnglishSummary,
  type EvidenceDetailRequirements,
} from "./webmcp-model-eval-scoring";
import {
  assertValidParaphraseMetadata,
  summarizeParaphraseFamilies,
  type ParaphraseEvalCall,
  type ParaphraseEvalCase,
  type ParaphraseRunOutcome,
  type ParaphraseUtteranceStyle,
} from "./webmcp-model-eval-paraphrases";
import { exactEvalCallMatch } from "./webmcp-model-eval-matching";

type EvalCall = ParaphraseEvalCall;

interface EvalCase extends ParaphraseEvalCase {
  availableAfter?: "completed_environmental_analysis" | "completed_home_wind_analysis";
  messages: Array<{ role: "user"; content: string }>;
  expectedAssistant?: {
    mustAskUserToChooseHazard?: boolean;
    mustWaitForUserReply?: boolean;
    mayListHazardsBeforeQuestion?: boolean;
  };
}

interface PostToolEvalCase {
  id: string;
  messages: Array<Record<string, unknown>>;
  expected: {
    toolCallsBeforeNextUserMessage?: EvalCall[];
    assistantMustAskUserToChoose?: boolean;
    assistantMustNotChooseCandidate?: boolean;
    assistantMustWaitForNextUserMessage?: boolean;
    toolCallsAfterUserReply?: EvalCall[];
    assistantMustContinueTask?: boolean;
    assistantMustFinishAfterToolResult?: boolean;
    assistantMustPreserveNoObservationBoundary?: boolean;
    assistantMustReportEveryChain?: string[];
    assistantMustUsePlainEnglish?: boolean;
    assistantMustLeadWithOverallSummary?: boolean;
    assistantMustIncludeEvidenceDetails?: EvidenceDetailRequirements;
  };
}

interface ApiFunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

interface ApiResponse {
  id: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<Record<string, unknown>>;
  output_text?: string;
  usage?: Record<string, unknown>;
  error?: unknown;
}

interface RunOutcome extends ParaphraseRunOutcome {
  case_id: string;
  paraphrase_family?: string;
  utterance_style?: ParaphraseUtteranceStyle;
  run: number;
  expected_calls: EvalCall[];
  actual_calls: EvalCall[];
  expected_argument_subset_match: boolean;
  assistant_expectations_match: boolean;
  semantic_match: boolean;
  response_ids: string[];
  response_text: string;
  usage: Array<Record<string, unknown> | undefined>;
  raw_responses: ApiResponse[];
}

type ReasoningEffort = "minimal" | "low" | "medium";

interface PostToolRunOutcome {
  case_id: string;
  run: number;
  expected_calls: EvalCall[];
  actual_calls: EvalCall[];
  response_text: string;
  final_response_text: string;
  expected_calls_match: boolean;
  asks_user_to_choose: boolean;
  waits_for_next_message: boolean;
  appears_to_choose_candidate: boolean;
  finishes_after_tool_result: boolean;
  preserves_no_observation_boundary: boolean;
  reports_every_chain: boolean;
  uses_plain_english: boolean;
  leads_with_overall_summary: boolean;
  includes_evidence_details: boolean;
  passed: boolean;
  response_ids: string[];
  usage: Array<Record<string, unknown> | undefined>;
  tool_execution_output?: unknown;
  raw_responses: ApiResponse[];
}

const SYSTEM_INSTRUCTIONS = [
  "You are evaluating a browser Agent against the exact WebMCP tools registered by Sky to Porch.",
  "Follow each tool description and JSON schema exactly.",
  "Call tools only when needed. Do not invent coordinates for a named place.",
  "For initial analysis time, use latest_completed unless the user stated exact dates; never invent a date or use today. After needs_place_choice, ignore that initial-time default and copy retry_with_original_arguments exactly, including its time.",
  "If a tool result requires user input, ask the user and wait; do not choose or call another tool before a new user message.",
  "When the user then chooses a returned place, resume the unfinished task with that choice and continue through the requested result.",
].join(" ");

function parseArgs() {
  const values = process.argv.slice(2);
  const option = (name: string) => {
    const index = values.indexOf(name);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const runs = Number(option("--runs") ?? "1");
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
    throw new Error("--runs must be an integer from 1 through 5");
  }
  const reasoning = option("--reasoning") ?? "low";
  if (!["minimal", "low", "medium"].includes(reasoning)) {
    throw new Error("--reasoning must be minimal, low, or medium");
  }
  return {
    runs,
    caseIds: (option("--case") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    model: option("--model") ?? "gpt-5-mini",
    reasoning: reasoning as ReasoningEffort,
    includePostTool: values.includes("--include-post-tool"),
  };
}

function sampleCompletedAnalysis(): ActiveAnalysis {
  return {
    analysisId: "model-eval-context",
    origin: "agent",
    request: {
      hazardId: "wind_storm",
      concern: "home",
      placeSelection: {},
      evidenceMode: "live",
    },
    outcome: {
      hazardId: "wind_storm",
      result: {
        kind: "success",
        claimDiscussion: {},
      },
    },
    completedAt: "2026-08-27T00:00:00.000Z",
  } as unknown as ActiveAnalysis;
}

function modelEvalAnalysis(request: AnalysisRequest): ActiveAnalysis {
  return {
    analysisId: `model-eval-completed-${request.hazardId}`,
    origin: "agent",
    request,
    outcome: {
      hazardId: request.hazardId,
      result: {
        kind: "unsupported_coverage",
        rejectionReason:
          "The model-evaluation fixture returned no official observation. This does not mean there is no danger.",
      },
    } as ActiveAnalysis["outcome"],
    completedAt: "2026-08-27T00:00:01.000Z",
  };
}

function modelEvalGeocoder(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
  const query = typeof body.query === "string" ? body.query : "Selected place";
  const results = query === "Springfield"
    ? [
        { id: "osm-r-1001", label: "Springfield, Massachusetts", lon: -72.5898, lat: 42.1015 },
        { id: "osm-r-1002", label: "Springfield, Illinois", lon: -89.6501, lat: 39.7817 },
        { id: "osm-r-1003", label: "Springfield, Missouri", lon: -93.2923, lat: 37.209 },
      ]
    : query === "Houston"
      ? [
          { id: "osm-r-2688911", label: "Houston, Texas, United States", lon: -95.3676974, lat: 29.7589382 },
          { id: "osm-r-1840945", label: "Houston, Texas, United States", lon: -95.390805, lat: 31.3378465 },
          { id: "osm-r-1074368", label: "Houston, Georgia, United States", lon: -83.631394, lat: 32.4659752 },
        ]
      : [{ id: "osm-r-selected", label: query, lon: -89.6501, lat: 39.7817 }];
  return Promise.resolve(new Response(JSON.stringify({
    ok: true,
    results,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

function availableTools(item?: EvalCase, executeAnalysis = false) {
  let mapState = createInitialEnvironmentalMapState();
  let placeSelection: PlaceSelection | null = null;
  const readMapState = () => ({ placeSelection, mapState });
  const commitMapUpdate = (update: {
    selection: PlaceSelection | null;
    date: string | null;
    layers: Parameters<typeof applyEnvironmentalMapDesiredState>[1];
    origin: "agent";
  }) => {
    const selectionChanged = !sameMapSelection(placeSelection, update.selection);
    placeSelection = update.selection;
    mapState = applyEnvironmentalMapDesiredState(mapState, update.layers, {
      date: update.date,
      contextChanged: selectionChanged,
      origin: update.origin,
    });
    return { mapState, analysisCleared: selectionChanged };
  };
  const tools = [
    createAnalyzeHazardTool(executeAnalysis
      ? {
          runAnalysis: async (request) => modelEvalAnalysis(request),
          fetchImpl: modelEvalGeocoder,
          now: () => new Date("2026-08-27T12:00:00.000Z"),
        }
      : { runAnalysis: async () => null }),
    createCompareHazardTool(executeAnalysis
      ? {
          runAnalysis: async (request) => modelEvalAnalysis(request),
          runAnalysisBundle: async (requests) => requests.map(modelEvalAnalysis),
          fetchImpl: modelEvalGeocoder,
          now: () => new Date("2026-08-27T12:00:00.000Z"),
        }
      : { runAnalysis: async () => null }),
    createEnvironmentalCapabilitiesTool(),
    createGetEnvironmentalSourceCoverageTool(),
    createSetEnvironmentalMapLayersTool({
      readState: readMapState,
      applyUpdate: commitMapUpdate,
      fetchImpl: modelEvalGeocoder,
      now: () => new Date("2026-08-27T12:00:00.000Z"),
    }),
    createLookUpPlaceLocationTool({
      readState: readMapState,
      applyUpdate: commitMapUpdate,
      publishFeedback: () => {},
      fetchImpl: modelEvalGeocoder,
      now: () => new Date("2026-08-27T12:00:00.000Z"),
    }),
  ];
  const activeAnalysis = item?.availableAfter ? sampleCompletedAnalysis() : null;
  if (activeAnalysis && item?.availableAfter === "completed_environmental_analysis") {
    activeAnalysis.request.concern = "general";
  }
  const readState = () => ({
    activeAnalysis,
    relatedAnalyses: [],
    onOpenStormClaimDiscussion: () => {},
  });
  return [
    ...tools,
    createStateBackedInspectEvidenceTool(readState),
    createStateBackedStormClaimDiscussionTool(readState),
  ];
}

function apiTools(tools: WebMCP.ModelContextTool[]) {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema ?? {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  }));
}

async function request(apiKey: string, body: Record<string, unknown>): Promise<ApiResponse> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as ApiResponse;
  if (!response.ok) {
    const message = typeof payload.error === "object" && payload.error !== null
      ? JSON.stringify(payload.error)
      : `HTTP ${response.status}`;
    throw new Error(`OpenAI Responses API failed: ${message}`);
  }
  return payload;
}

function functionCalls(response: ApiResponse): ApiFunctionCall[] {
  return (response.output ?? [])
    .filter((item) => item.type === "function_call")
    .map((item) => item as unknown as ApiFunctionCall);
}

function responseText(response: ApiResponse): string {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? []).flatMap((item) => {
    if (item.type !== "message" || !Array.isArray(item.content)) return [];
    return item.content.flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      const record = part as Record<string, unknown>;
      return record.type === "output_text" && typeof record.text === "string"
        ? [record.text]
        : [];
    });
  }).join("\n");
}

function parseCall(item: ApiFunctionCall): EvalCall {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(item.arguments) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    args = { __invalid_json: item.arguments };
  }
  return { functionName: item.name, arguments: args };
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      expected.every((item, index) => sameValue(actual[index], item));
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
    const actualRecord = actual as Record<string, unknown>;
    return Object.entries(expected as Record<string, unknown>)
      .every(([key, value]) => sameValue(actualRecord[key], value));
  }
  return Object.is(actual, expected);
}

function exactCall(actual: EvalCall, expected: EvalCall): boolean {
  return exactEvalCallMatch(actual, expected);
}

function semanticArgumentsMatch(actual: EvalCall, expected: EvalCall): boolean {
  const actualArgs = actual.arguments;
  const expectedArgs = expected.arguments;
  if (actual.functionName !== expected.functionName) return false;
  if (
    actual.functionName === "compare_environmental_evidence" ||
    actual.functionName === "inspect_current_environmental_evidence"
  ) {
    // These tools have safe optional fields. A model may explicitly send their
    // schema defaults or narrow an inspection to the active hazard.
    return sameValue(actualArgs, expectedArgs);
  }
  if (actual.functionName !== "analyze_environmental_hazard") {
    return exactEvalCallMatch(actual, expected);
  }

  for (const [key, expectedValue] of Object.entries(expectedArgs)) {
    const actualValue = actualArgs[key];
    if (key === "question") {
      if (typeof actualValue !== "string" || actualValue.trim().length === 0) return false;
      continue;
    }
    if (key === "place" && typeof expectedValue === "string") {
      if (typeof actualValue !== "string") return false;
      const expectedPlace = normalizeEvalPlace(expectedValue);
      const actualPlace = normalizeEvalPlace(actualValue);
      if (actualPlace !== expectedPlace && !actualPlace.startsWith(`${expectedPlace},`)) {
        return false;
      }
      continue;
    }
    if (key === "hazard" && typeof expectedValue === "string" && typeof actualValue === "string") {
      if (actualValue === expectedValue) continue;
      const expectedRelated = DEFAULT_RELATED_HAZARDS[
        expectedValue as keyof typeof DEFAULT_RELATED_HAZARDS
      ] as readonly string[] | undefined;
      const actualRelated = DEFAULT_RELATED_HAZARDS[
        actualValue as keyof typeof DEFAULT_RELATED_HAZARDS
      ] as readonly string[] | undefined;
      const interchangeableRelatedPair = !("analysis_scope" in expectedArgs) &&
        actualArgs.analysis_scope === "related_context" &&
        expectedRelated?.includes(actualValue) &&
        actualRelated?.includes(expectedValue);
      if (!interchangeableRelatedPair) return false;
      continue;
    }
    if (!sameValue(actualValue, expectedValue)) return false;
  }

  for (const key of [
    "start_date",
    "end_date",
    "latitude",
    "longitude",
    "place_choice_id",
  ] as const) {
    if (
      !(key in expectedArgs) &&
      key in actualArgs &&
      !(key === "place_choice_id" && actualArgs[key] === null)
    ) return false;
  }
  return true;
}

function assistantExpectationsMatch(
  item: EvalCase,
  actualCalls: EvalCall[],
  text: string
): boolean {
  if (!item.expectedAssistant) return true;
  if (
    item.expectedAssistant.mustAskUserToChooseHazard &&
    !asksUserToChooseHazard(text)
  ) return false;
  const onlyAllowedClarificationCall = actualCalls.length === 0 || (
    item.expectedAssistant.mayListHazardsBeforeQuestion === true &&
    actualCalls.length === 1 &&
    actualCalls[0].functionName === "get_sky_to_porch_help_and_demos" &&
    Object.keys(actualCalls[0].arguments).length === 0
  );
  if (item.expectedAssistant.mustWaitForUserReply && !onlyAllowedClarificationCall) return false;
  return true;
}

function selectionCallsSemanticMatch(item: EvalCase, actualCalls: EvalCall[]): boolean {
  const expectedCallsMatch = actualCalls.length === item.expectedCall.length && actualCalls.every(
    (call, index) => semanticArgumentsMatch(call, item.expectedCall[index])
  );
  if (expectedCallsMatch) return true;
  return item.expectedCall.length === 0 &&
    item.expectedAssistant?.mayListHazardsBeforeQuestion === true &&
    actualCalls.length === 1 &&
    actualCalls[0].functionName === "get_sky_to_porch_help_and_demos" &&
    Object.keys(actualCalls[0].arguments).length === 0;
}

async function executeForContinuation(
  tools: WebMCP.ModelContextTool[],
  call: ApiFunctionCall
): Promise<unknown> {
  const tool = tools.find((item) => item.name === call.name);
  if (!tool) return { status: "unknown_tool" };
  const parsed = parseCall(call).arguments;
  return tool.execute(parsed, { signal: new AbortController().signal });
}

async function runSelectionCase(
  apiKey: string,
  model: string,
  reasoning: ReasoningEffort,
  item: EvalCase,
  run: number
): Promise<RunOutcome> {
  const tools = availableTools(item);
  const actualCalls: EvalCall[] = [];
  const responses: ApiResponse[] = [];
  let input: unknown = item.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  let previousResponseId: string | undefined;

  const maximumTurns = Math.max(
    1,
    item.expectedCall.length,
    item.expectedAssistant?.mayListHazardsBeforeQuestion ? 2 : 1
  );
  for (let turn = 0; turn < maximumTurns; turn += 1) {
    const response = await request(apiKey, {
      model,
      instructions: SYSTEM_INSTRUCTIONS,
      input,
      tools: apiTools(tools),
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { effort: reasoning },
      text: { verbosity: "low" },
      max_output_tokens: 2_000,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    });
    responses.push(response);
    const calls = functionCalls(response);
    if (calls.length === 0) break;
    const call = calls[0];
    actualCalls.push(parseCall(call));
    const allowedClarificationPreflight =
      item.expectedAssistant?.mayListHazardsBeforeQuestion === true &&
      actualCalls.length === 1 &&
      call.name === "get_sky_to_porch_help_and_demos";
    if (actualCalls.length >= item.expectedCall.length && !allowedClarificationPreflight) break;
    const result = await executeForContinuation(tools, call);
    previousResponseId = response.id;
    input = [{
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(result),
    }];
  }

  const exact = actualCalls.length === item.expectedCall.length && actualCalls.every(
    (call, index) => exactCall(call, item.expectedCall[index])
  );
  const subset = actualCalls.length === item.expectedCall.length && actualCalls.every(
    (call, index) => call.functionName === item.expectedCall[index].functionName &&
      sameValue(call.arguments, item.expectedCall[index].arguments)
  );
  const callSemanticsMatch = selectionCallsSemanticMatch(item, actualCalls);
  const combinedResponseText = responses.map(responseText).filter(Boolean).join("\n");
  const assistantMatch = assistantExpectationsMatch(item, actualCalls, combinedResponseText);
  const semantic = callSemanticsMatch && assistantMatch;
  return {
    case_id: item.id,
    ...(item.paraphraseFamily ? { paraphrase_family: item.paraphraseFamily } : {}),
    ...(item.utteranceStyle ? { utterance_style: item.utteranceStyle } : {}),
    run,
    expected_calls: item.expectedCall,
    actual_calls: actualCalls,
    exact_match: exact,
    expected_argument_subset_match: subset,
    assistant_expectations_match: assistantMatch,
    semantic_match: semantic,
    response_ids: responses.map((response) => response.id),
    response_text: combinedResponseText,
    usage: responses.map((response) => response.usage),
    raw_responses: responses,
  };
}

function postToolInput(item: PostToolEvalCase): Array<Record<string, unknown>> {
  const toolMessage = item.messages[2] as {
    functionName: string;
    content: Record<string, unknown>;
  };
  const assistantMessage = item.messages[1] as {
    functionCall: { functionName: string; arguments: Record<string, unknown> };
  };
  const callId = "call_post_tool_eval";
  return [
    item.messages[0],
    {
      type: "function_call",
      call_id: callId,
      name: assistantMessage.functionCall.functionName,
      arguments: JSON.stringify(assistantMessage.functionCall.arguments),
    },
    {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(toolMessage.content),
    },
    ...item.messages.slice(3).map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

async function runPostToolCase(
  apiKey: string,
  model: string,
  reasoning: ReasoningEffort,
  item: PostToolEvalCase,
  run: number
): Promise<PostToolRunOutcome> {
  const tools = availableTools(undefined, true);
  const firstResponse = await request(apiKey, {
    model,
    instructions: SYSTEM_INSTRUCTIONS,
    input: postToolInput(item),
    tools: apiTools(tools),
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort: reasoning },
    text: { verbosity: "low" },
    max_output_tokens: 2_000,
  });
  const responses = [firstResponse];
  const text = responseText(firstResponse);
  const apiCalls = functionCalls(firstResponse);
  const calls = apiCalls.map(parseCall);
  const expectedCalls = item.expected.toolCallsAfterUserReply ??
    item.expected.toolCallsBeforeNextUserMessage ?? [];
  const expectedCallsMatch = calls.length === expectedCalls.length && calls.every(
    (call, index) => semanticArgumentsMatch(call, expectedCalls[index])
  );
  const asksUserToChoose = /\b(which|choose|select)\b/iu.test(text);
  const waitsForNextMessage = calls.length === 0;
  const appearsToChooseCandidate = /\bI(?:'ll| will| choose| chose)\s+(?:use|choose)?\s*(?:(?:Springfield,\s*)?(?:Massachusetts|Illinois|Missouri)|(?:the\s+)?(?:first|second)\s+Houston)\b/iu.test(text);
  let toolExecutionOutput: unknown;
  let finalResponseText = "";
  let finalCalls: EvalCall[] = [];
  if (
    item.expected.assistantMustFinishAfterToolResult &&
    expectedCallsMatch &&
    apiCalls.length === 1
  ) {
    toolExecutionOutput = await executeForContinuation(tools, apiCalls[0]);
    const finalResponse = await request(apiKey, {
      model,
      instructions: SYSTEM_INSTRUCTIONS,
      input: [{
        type: "function_call_output",
        call_id: apiCalls[0].call_id,
        output: JSON.stringify(toolExecutionOutput),
      }],
      previous_response_id: firstResponse.id,
      tools: apiTools(tools),
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { effort: reasoning },
      text: { verbosity: "low" },
      max_output_tokens: 2_000,
    });
    responses.push(finalResponse);
    finalResponseText = responseText(finalResponse);
    finalCalls = functionCalls(finalResponse).map(parseCall);
  }
  const finishesAfterToolResult = !item.expected.assistantMustFinishAfterToolResult || (
    finalCalls.length === 0 && finalResponseText.trim().length > 0
  );
  const preservesNoObservationBoundaryResult =
    !item.expected.assistantMustPreserveNoObservationBoundary ||
    preservesNoObservationBoundary(finalResponseText);
  const summaryText = finalResponseText.trim().length > 0 ? finalResponseText : text;
  const multiChainScore = scoreMultiChainPlainEnglishSummary(
    summaryText,
    item.expected.assistantMustReportEveryChain ?? [],
    item.expected.assistantMustIncludeEvidenceDetails
  );
  const reportsEveryChain = !item.expected.assistantMustReportEveryChain ||
    multiChainScore.reportsEveryChain;
  const usesPlainEnglish = !item.expected.assistantMustUsePlainEnglish ||
    multiChainScore.usesPlainEnglish;
  const leadsWithOverallSummary = !item.expected.assistantMustLeadWithOverallSummary ||
    multiChainScore.leadsWithOverallSummary;
  const includesEvidenceDetails = item.expected.assistantMustIncludeEvidenceDetails === undefined ||
    multiChainScore.includesEvidenceDetails;
  const passed = item.expected.assistantMustContinueTask
    ? expectedCallsMatch && finishesAfterToolResult && preservesNoObservationBoundaryResult &&
      reportsEveryChain && usesPlainEnglish && leadsWithOverallSummary && includesEvidenceDetails
    : expectedCallsMatch && asksUserToChoose && waitsForNextMessage && !appearsToChooseCandidate;
  return {
    case_id: item.id,
    run,
    expected_calls: expectedCalls,
    actual_calls: calls,
    response_text: text,
    final_response_text: finalResponseText,
    expected_calls_match: expectedCallsMatch,
    asks_user_to_choose: asksUserToChoose,
    waits_for_next_message: waitsForNextMessage,
    appears_to_choose_candidate: appearsToChooseCandidate,
    finishes_after_tool_result: finishesAfterToolResult,
    preserves_no_observation_boundary: preservesNoObservationBoundaryResult,
    reports_every_chain: reportsEveryChain,
    uses_plain_english: usesPlainEnglish,
    leads_with_overall_summary: leadsWithOverallSummary,
    includes_evidence_details: includesEvidenceDetails,
    passed,
    response_ids: responses.map((response) => response.id),
    usage: responses.map((response) => response.usage),
    ...(toolExecutionOutput !== undefined ? { tool_execution_output: toolExecutionOutput } : {}),
    raw_responses: responses,
  };
}

function numericUsage(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageSummary(
  model: string,
  records: Array<Record<string, unknown> | undefined>
) {
  const inputTokens = records.reduce((sum, record) => sum + numericUsage(record, "input_tokens"), 0);
  const outputTokens = records.reduce((sum, record) => sum + numericUsage(record, "output_tokens"), 0);
  const cachedInputTokens = records.reduce((sum, record) => {
    const details = record?.input_tokens_details;
    return sum + (typeof details === "object" && details !== null
      ? numericUsage(details as Record<string, unknown>, "cached_tokens")
      : 0);
  }, 0);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const estimatedCostUsd = model === "gpt-5-mini"
    ? (uncachedInputTokens * 0.25 + cachedInputTokens * 0.025 + outputTokens * 2) / 1_000_000
    : null;
  return {
    response_count: records.length,
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: estimatedCostUsd,
    estimate_basis: estimatedCostUsd === null
      ? null
      : "gpt-5-mini public token rates checked 2026-08-27; excludes account-specific adjustments",
  };
}

async function main() {
  loadEnvConfig(process.cwd());
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const options = parseArgs();
  const parsedDataset: unknown = JSON.parse(await readFile(resolve(
    process.cwd(),
    "tests/webmcp/tool-selection-evals.json"
  ), "utf8"));
  assertValidParaphraseMetadata(parsedDataset);
  const dataset = parsedDataset as EvalCase[];
  const postToolDataset = JSON.parse(await readFile(resolve(
    process.cwd(),
    "tests/webmcp/post-tool-behavior-evals.json"
  ), "utf8")) as PostToolEvalCase[];
  const selected = options.caseIds.length > 0
    ? dataset.filter((item) => options.caseIds.includes(item.id))
    : dataset;
  const selectedPostTool = options.caseIds.length > 0
    ? postToolDataset.filter((item) => options.caseIds.includes(item.id))
    : options.includePostTool
      ? postToolDataset
      : [];
  const knownIds = new Set([...dataset, ...postToolDataset].map((item) => item.id));
  const unknownIds = options.caseIds.filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown case: ${unknownIds.join(", ")}`);
  }

  const outcomes: RunOutcome[] = [];
  const postToolOutcomes: PostToolRunOutcome[] = [];
  for (let run = 1; run <= options.runs; run += 1) {
    for (const item of selected) {
      outcomes.push(await runSelectionCase(
        apiKey,
        options.model,
        options.reasoning,
        item,
        run
      ));
      const outcome = outcomes.at(-1);
      const selectionPassed = item.paraphraseFamily
        ? outcome?.exact_match
        : outcome?.semantic_match;
      console.log(`[${run}/${options.runs}] ${item.id}: ${selectionPassed ? "PASS" : "CHECK"}`);
    }
    for (const item of selectedPostTool) {
      const outcome = await runPostToolCase(
        apiKey,
        options.model,
        options.reasoning,
        item,
        run
      );
      postToolOutcomes.push(outcome);
      console.log(`[${run}/${options.runs}] ${item.id}: ${outcome.passed ? "PASS" : "CHECK"}`);
    }
  }

  const exactPasses = outcomes.filter((item) => item.exact_match).length;
  const subsetPasses = outcomes.filter((item) => item.expected_argument_subset_match).length;
  const semanticPasses = outcomes.filter((item) => item.semantic_match).length;
  const paraphraseSummary = summarizeParaphraseFamilies(dataset, outcomes, options.runs);
  const usage = usageSummary(options.model, [
    ...outcomes.flatMap((item) => item.usage),
    ...postToolOutcomes.flatMap((item) => item.usage),
  ]);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const outputDirectory = resolve(process.cwd(), "artifacts/webmcp-evals");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, `${timestamp}-${options.model}.json`);
  await writeFile(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    model: options.model,
    reasoning_effort: options.reasoning,
    runs: options.runs,
    selection_summary: {
      exact_passes: exactPasses,
      expected_argument_subset_passes: subsetPasses,
      semantic_passes: semanticPasses,
      total: outcomes.length,
    },
    paraphrase_summary: paraphraseSummary,
    post_tool_summary: {
      passes: postToolOutcomes.filter((item) => item.passed).length,
      total: postToolOutcomes.length,
    },
    usage_summary: usage,
    outcomes,
    post_tool_outcomes: postToolOutcomes,
  }, null, 2));
  console.log(`Selection exact: ${exactPasses}/${outcomes.length}`);
  console.log(`Selection expected-subset: ${subsetPasses}/${outcomes.length}`);
  console.log(`Selection semantic: ${semanticPasses}/${outcomes.length}`);
  console.log(
    `Paraphrase families (exact calls): ${paraphraseSummary.passes}/` +
    `${paraphraseSummary.expected_runs}; ${paraphraseSummary.executed_runs} executed; ` +
    `${paraphraseSummary.complete ? "COMPLETE" : "INCOMPLETE"}; ` +
    `${paraphraseSummary.all_passed ? "PASS" : "CHECK"}`
  );
  for (const family of paraphraseSummary.families) {
    console.log(
      `Paraphrase ${family.family} (${family.expected_tool}): ` +
      `${family.passes}/${family.expected_runs} exact; ${family.executed_runs} executed; ` +
      `${family.complete ? "COMPLETE" : "INCOMPLETE"}; ` +
      `${family.all_passed ? "PASS" : "CHECK"}`
    );
    for (const failure of family.failed_cases) {
      console.log(
        `  Failed ${failure.case_id} (${failure.utterance_style}) runs: ` +
        failure.runs.join(", ")
      );
    }
    for (const missing of family.missing_cases) {
      console.log(
        `  Missing ${missing.case_id} (${missing.utterance_style}) runs: ` +
        missing.runs.join(", ")
      );
    }
  }
  console.log(`Post-tool behavior: ${postToolOutcomes.filter((item) => item.passed).length}/${postToolOutcomes.length}`);
  if (usage.estimated_cost_usd !== null) {
    console.log(`Estimated API cost: $${usage.estimated_cost_usd.toFixed(4)}`);
  }
  console.log(`Raw outcomes: ${outputPath}`);
}

await main();
