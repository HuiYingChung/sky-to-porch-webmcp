import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import {
  createAnalyzeHazardTool,
  DEFAULT_RELATED_HAZARDS,
} from "@/lib/webmcp/analyze-tool";
import {
  createInspectEvidenceTool,
  createStormClaimDiscussionTool,
} from "@/lib/webmcp/context-tools";
import {
  createGetEnvironmentalSourceCoverageTool,
  createListEnvironmentalHazardsTool,
} from "@/lib/webmcp/discovery-tools";

interface EvalCall {
  functionName: string;
  arguments: Record<string, unknown>;
}

interface EvalCase {
  id: string;
  availableAfter?: "completed_environmental_analysis" | "completed_home_wind_analysis";
  messages: Array<{ role: "user"; content: string }>;
  expectedCall: EvalCall[];
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

interface RunOutcome {
  case_id: string;
  run: number;
  expected_calls: EvalCall[];
  actual_calls: EvalCall[];
  exact_match: boolean;
  expected_argument_subset_match: boolean;
  semantic_match: boolean;
  response_ids: string[];
  response_text: string;
  usage: Array<Record<string, unknown> | undefined>;
  raw_responses: ApiResponse[];
}

const SYSTEM_INSTRUCTIONS = [
  "You are evaluating a browser Agent against the exact WebMCP tools registered by Sky to Porch.",
  "Follow each tool description and JSON schema exactly.",
  "Call tools only when needed. Do not invent coordinates for a named place.",
  "For analysis time, use latest_completed unless the user stated exact dates; never invent a date or use today.",
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
  return {
    runs,
    caseId: option("--case"),
    model: option("--model") ?? "gpt-5-mini",
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

function availableTools(item?: EvalCase) {
  const baseline = [
    createAnalyzeHazardTool({ runAnalysis: async () => null }),
    createListEnvironmentalHazardsTool(),
    createGetEnvironmentalSourceCoverageTool(),
  ];
  if (!item?.availableAfter) return baseline;
  const analysis = sampleCompletedAnalysis();
  const contextual = [createInspectEvidenceTool(analysis)];
  if (item.availableAfter === "completed_home_wind_analysis") {
    const claim = createStormClaimDiscussionTool(analysis, () => {});
    if (claim) contextual.push(claim);
  }
  return [...baseline, ...contextual];
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
  return actual.functionName === expected.functionName &&
    sameValue(actual.arguments, expected.arguments) &&
    Object.keys(actual.arguments).length === Object.keys(expected.arguments).length;
}

function normalizedPlace(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}

function semanticArgumentsMatch(actual: EvalCall, expected: EvalCall): boolean {
  const actualArgs = actual.arguments;
  const expectedArgs = expected.arguments;
  if (actual.functionName !== expected.functionName) return false;
  if (actual.functionName !== "analyze_environmental_hazard") {
    return sameValue(actualArgs, expectedArgs) &&
      Object.keys(actualArgs).length === Object.keys(expectedArgs).length;
  }

  for (const [key, expectedValue] of Object.entries(expectedArgs)) {
    const actualValue = actualArgs[key];
    if (key === "question") {
      if (typeof actualValue !== "string" || actualValue.trim().length === 0) return false;
      continue;
    }
    if (key === "place" && typeof expectedValue === "string") {
      if (typeof actualValue !== "string") return false;
      const expectedPlace = normalizedPlace(expectedValue);
      const actualPlace = normalizedPlace(actualValue);
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

  for (const key of ["start_date", "end_date", "latitude", "longitude"] as const) {
    if (!(key in expectedArgs) && key in actualArgs) return false;
  }
  return true;
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

  for (let turn = 0; turn < Math.max(1, item.expectedCall.length); turn += 1) {
    const response = await request(apiKey, {
      model,
      instructions: SYSTEM_INSTRUCTIONS,
      input,
      tools: apiTools(tools),
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" },
      max_output_tokens: 2_000,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    });
    responses.push(response);
    const calls = functionCalls(response);
    if (calls.length === 0) break;
    const call = calls[0];
    actualCalls.push(parseCall(call));
    if (actualCalls.length >= item.expectedCall.length) break;
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
  const semantic = actualCalls.length === item.expectedCall.length && actualCalls.every(
    (call, index) => semanticArgumentsMatch(call, item.expectedCall[index])
  );
  return {
    case_id: item.id,
    run,
    expected_calls: item.expectedCall,
    actual_calls: actualCalls,
    exact_match: exact,
    expected_argument_subset_match: subset,
    semantic_match: semantic,
    response_ids: responses.map((response) => response.id),
    response_text: responses.map(responseText).filter(Boolean).join("\n"),
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
  const callId = "call_ambiguous_place_eval";
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
  item: PostToolEvalCase,
  run: number
) {
  const response = await request(apiKey, {
    model,
    instructions: SYSTEM_INSTRUCTIONS,
    input: postToolInput(item),
    tools: apiTools(availableTools()),
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort: "minimal" },
    text: { verbosity: "low" },
    max_output_tokens: 2_000,
  });
  const text = responseText(response);
  const calls = functionCalls(response).map(parseCall);
  const expectedCalls = item.expected.toolCallsAfterUserReply ??
    item.expected.toolCallsBeforeNextUserMessage ?? [];
  const expectedCallsMatch = calls.length === expectedCalls.length && calls.every(
    (call, index) => semanticArgumentsMatch(call, expectedCalls[index])
  );
  const asksUserToChoose = /\b(which|choose|select)\b/iu.test(text);
  const waitsForNextMessage = calls.length === 0;
  const appearsToChooseCandidate = /\b(I(?:'ll| will| choose| chose) (?:use|choose)?\s*(?:Springfield,\s*)?(?:Massachusetts|Illinois|Missouri))\b/iu.test(text);
  const passed = item.expected.assistantMustContinueTask
    ? expectedCallsMatch
    : expectedCallsMatch && asksUserToChoose && waitsForNextMessage && !appearsToChooseCandidate;
  return {
    case_id: item.id,
    run,
    expected_calls: expectedCalls,
    actual_calls: calls,
    response_text: text,
    expected_calls_match: expectedCallsMatch,
    asks_user_to_choose: asksUserToChoose,
    waits_for_next_message: waitsForNextMessage,
    appears_to_choose_candidate: appearsToChooseCandidate,
    passed,
    response_id: response.id,
    usage: response.usage,
    raw_response: response,
  };
}

async function main() {
  loadEnvConfig(process.cwd());
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const options = parseArgs();
  const dataset = JSON.parse(await readFile(resolve(
    process.cwd(),
    "tests/webmcp/tool-selection-evals.json"
  ), "utf8")) as EvalCase[];
  const postToolDataset = JSON.parse(await readFile(resolve(
    process.cwd(),
    "tests/webmcp/post-tool-behavior-evals.json"
  ), "utf8")) as PostToolEvalCase[];
  const selected = options.caseId
    ? dataset.filter((item) => item.id === options.caseId)
    : dataset;
  const selectedPostTool = options.caseId
    ? postToolDataset.filter((item) => item.id === options.caseId)
    : options.includePostTool
      ? postToolDataset
      : [];
  if (options.caseId && selected.length === 0 && selectedPostTool.length === 0) {
    throw new Error(`Unknown case: ${options.caseId}`);
  }

  const outcomes: RunOutcome[] = [];
  const postToolOutcomes: unknown[] = [];
  for (let run = 1; run <= options.runs; run += 1) {
    for (const item of selected) {
      outcomes.push(await runSelectionCase(apiKey, options.model, item, run));
      console.log(`[${run}/${options.runs}] ${item.id}: ${outcomes.at(-1)?.exact_match ? "PASS" : "CHECK"}`);
    }
    for (const item of selectedPostTool) {
      const outcome = await runPostToolCase(apiKey, options.model, item, run);
      postToolOutcomes.push(outcome);
      console.log(`[${run}/${options.runs}] ${item.id}: ${outcome.passed ? "PASS" : "CHECK"}`);
    }
  }

  const exactPasses = outcomes.filter((item) => item.exact_match).length;
  const subsetPasses = outcomes.filter((item) => item.expected_argument_subset_match).length;
  const semanticPasses = outcomes.filter((item) => item.semantic_match).length;
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const outputDirectory = resolve(process.cwd(), "artifacts/webmcp-evals");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, `${timestamp}-${options.model}.json`);
  await writeFile(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    model: options.model,
    runs: options.runs,
    selection_summary: {
      exact_passes: exactPasses,
      expected_argument_subset_passes: subsetPasses,
      semantic_passes: semanticPasses,
      total: outcomes.length,
    },
    post_tool_summary: {
      passes: postToolOutcomes.filter((item) => (
        item as { passed?: boolean }
      ).passed).length,
      total: postToolOutcomes.length,
    },
    outcomes,
    post_tool_outcomes: postToolOutcomes,
  }, null, 2));
  console.log(`Selection exact: ${exactPasses}/${outcomes.length}`);
  console.log(`Selection expected-subset: ${subsetPasses}/${outcomes.length}`);
  console.log(`Selection semantic: ${semanticPasses}/${outcomes.length}`);
  console.log(`Raw outcomes: ${outputPath}`);
}

await main();
