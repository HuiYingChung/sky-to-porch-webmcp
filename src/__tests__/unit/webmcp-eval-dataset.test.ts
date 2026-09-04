import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HAZARD_IDS } from "@/contracts/common";
import {
  ANALYZE_HAZARD_INPUT_SCHEMA,
  ANALYZE_HAZARD_TOOL_NAME,
  COMPARE_HAZARD_INPUT_SCHEMA,
  COMPARE_HAZARD_TOOL_NAME,
} from "@/lib/webmcp/analyze-tool";
import {
  GET_COVERAGE_INPUT_SCHEMA,
  GET_COVERAGE_TOOL_NAME,
  CAPABILITIES_INPUT_SCHEMA,
  CAPABILITIES_TOOL_NAME,
} from "@/lib/webmcp/discovery-tools";
import {
  INSPECT_EVIDENCE_INPUT_SCHEMA,
  INSPECT_EVIDENCE_TOOL_NAME,
  PREPARE_STORM_CLAIM_INPUT_SCHEMA,
  PREPARE_STORM_CLAIM_TOOL_NAME,
} from "@/lib/webmcp/context-tools";
import {
  SET_ENVIRONMENTAL_MAP_LAYERS_INPUT_SCHEMA,
  SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME,
} from "@/lib/webmcp/map-tool";
import {
  LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA,
  LOOK_UP_PLACE_LOCATION_TOOL_NAME,
} from "@/lib/webmcp/place-tool";
import {
  assertValidParaphraseMetadata,
  PARAPHRASE_UTTERANCE_STYLES,
  summarizeParaphraseFamilies,
  type ParaphraseEvalCall,
  type ParaphraseEvalCase,
} from "../../../scripts/webmcp-model-eval-paraphrases";

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

const REGISTERED_TOOL_NAMES = [
  ANALYZE_HAZARD_TOOL_NAME,
  COMPARE_HAZARD_TOOL_NAME,
  CAPABILITIES_TOOL_NAME,
  GET_COVERAGE_TOOL_NAME,
  INSPECT_EVIDENCE_TOOL_NAME,
  PREPARE_STORM_CLAIM_TOOL_NAME,
  SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME,
  LOOK_UP_PLACE_LOCATION_TOOL_NAME,
] as const;

interface PostToolBehaviorCase {
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
    assistantMustIncludeEvidenceDetails?: {
      requiredTime: string;
      sourceTermGroups: string[][];
      requireLimitation: boolean;
    };
  };
}

describe("WebMCP tool-selection eval dataset", () => {
  const parsedDataset: unknown = JSON.parse(readFileSync(resolve(
    process.cwd(),
    "tests/webmcp/tool-selection-evals.json"
  ), "utf8"));
  assertValidParaphraseMetadata(parsedDataset);
  const dataset = parsedDataset as EvalCase[];
  const postToolDataset = JSON.parse(readFileSync(resolve(
    process.cwd(),
    "tests/webmcp/post-tool-behavior-evals.json"
  ), "utf8")) as PostToolBehaviorCase[];

  it("has unique bounded cases including an out-of-scope no-call", () => {
    expect(dataset.length).toBeGreaterThanOrEqual(6);
    expect(new Set(dataset.map((item) => item.id)).size).toBe(dataset.length);
    expect(dataset.some((item) => item.expectedCall.length === 0)).toBe(true);
    expect(dataset.some((item) => item.id.includes("ambiguous"))).toBe(true);
  });

  it("locks the ambiguous-place stop-and-wait behavior for model-backed runs", () => {
    expect(postToolDataset).toHaveLength(5);
    const item = postToolDataset.find(
      (candidate) => candidate.id === "ambiguous-place-must-wait-for-person"
    );
    expect(item).toBeDefined();
    if (!item) throw new Error("Missing ambiguous wait eval case");
    expect(item.id).toBe("ambiguous-place-must-wait-for-person");
    expect(item.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
    expect(item.messages[2]).toMatchObject({
      functionName: ANALYZE_HAZARD_TOOL_NAME,
      content: {
        status: "needs_place_choice",
        requires_user_input: true,
        required_next_action: "ask_user_to_choose_place_and_wait",
        must_not_select_place: true,
        must_not_retry_before_user_reply: true,
        after_user_choice: {
          required_next_action: "retry_analysis_with_selected_place",
          continue_task: true,
          set_place_choice_id_to_selected_choice_id: true,
          preserve_original_place: true,
        },
      },
    });
    expect(item.expected).toEqual({
      toolCallsBeforeNextUserMessage: [],
      assistantMustAskUserToChoose: true,
      assistantMustNotChooseCandidate: true,
      assistantMustWaitForNextUserMessage: true,
    });
  });

  it("locks the generic-storm final answer to both chains in plain English", () => {
    const item = postToolDataset.find(
      (candidate) => candidate.id === "generic-storm-reports-both-chains-plain-english"
    );
    expect(item).toBeDefined();
    if (!item) throw new Error("Missing generic storm summary eval case");

    expect(item.messages[2]).toMatchObject({
      functionName: ANALYZE_HAZARD_TOOL_NAME,
      content: {
        status: "related_environmental_evidence_bundle",
        included_chains: ["wind_storm", "flood_storm"],
        must_report_every_chain: true,
        required_chain_reporting: "report_each_included_chain",
        agent_response_contract: {
          style: "plain_english",
          avoid_internal_names: true,
          use_chain_name: true,
          use_status_summary: true,
          use_overall_summary: true,
          summary_first: true,
          per_chain_fields: "status_strongest_evidence_time_source_limitation",
        },
        overall_summary: "Wind & Storm: no matching observation returned; Flood & Heavy Rain: observations returned",
      },
    });
    expect(item.expected).toEqual({
      toolCallsAfterUserReply: [],
      assistantMustContinueTask: true,
      assistantMustReportEveryChain: ["wind_storm", "flood_storm"],
      assistantMustUsePlainEnglish: true,
      assistantMustLeadWithOverallSummary: true,
      assistantMustIncludeEvidenceDetails: {
        requiredTime: "2026-08-28",
        sourceTermGroups: [
          ["NWS", "National Weather Service", "Local Storm Report"],
          ["NOAA", "Iowa Environmental Mesonet", "IEM"],
        ],
        requireLimitation: true,
      },
    });
  });

  it("locks the post-choice continuation through the analysis tool", () => {
    const item = postToolDataset.find(
      (candidate) => candidate.id === "ambiguous-place-resumes-after-person-choice"
    );
    expect(item).toBeDefined();
    if (!item) throw new Error("Missing ambiguous continuation eval case");

    expect(item.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    expect(item.messages.at(-1)).toEqual({
      role: "user",
      content: "Springfield, Illinois.",
    });
    expect(item.expected).toEqual({
      toolCallsAfterUserReply: [{
        functionName: ANALYZE_HAZARD_TOOL_NAME,
        arguments: {
          place: "Springfield",
          place_choice_id: "place-osm-r-1002",
          hazard: "fire_smoke",
          time: "latest_completed",
          analysis_scope: "single_hazard_only",
        },
      }],
      assistantMustContinueTask: true,
      assistantMustFinishAfterToolResult: true,
      assistantMustPreserveNoObservationBoundary: true,
    });
  });

  it("locks identical-label Houston continuation to the selected stable id", () => {
    const item = postToolDataset.find(
      (candidate) => candidate.id === "identical-label-place-resumes-by-choice-id"
    );
    expect(item).toBeDefined();
    if (!item) throw new Error("Missing identical-label continuation eval case");

    const toolOutput = item.messages[2] as {
      content: { choices: Array<{ choice_id: string; label: string }> };
    };
    expect(toolOutput.content.choices.slice(0, 2)).toEqual([
      { choice_id: "place-osm-r-2688911", label: "Houston, Texas, United States" },
      { choice_id: "place-osm-r-1840945", label: "Houston, Texas, United States" },
    ]);
    expect(item.messages.at(-1)).toEqual({ role: "user", content: "first Houston" });
    expect(item.expected.toolCallsAfterUserReply?.[0]).toEqual({
      functionName: ANALYZE_HAZARD_TOOL_NAME,
      arguments: {
        place: "Houston",
        place_choice_id: "place-osm-r-2688911",
        hazard: "wind_storm",
        concern: "home",
        time: "2024-07-08",
        analysis_scope: "related_context",
      },
    });
  });

  it("asks and waits instead of guessing a broad missing hazard", () => {
    const selection = dataset.find(
      (item) => item.id === "broad-goal-ask-clarification"
    );
    expect(selection).toMatchObject({
      expectedCall: [],
      expectedAssistant: {
        mustAskUserToChooseHazard: true,
        mustWaitForUserReply: true,
        mayListHazardsBeforeQuestion: true,
      },
    });
  });

  it("keeps expected calls aligned with the registered tool contract", () => {
    const schemas = {
      [ANALYZE_HAZARD_TOOL_NAME]: ANALYZE_HAZARD_INPUT_SCHEMA.properties,
      [COMPARE_HAZARD_TOOL_NAME]: COMPARE_HAZARD_INPUT_SCHEMA.properties,
      [CAPABILITIES_TOOL_NAME]: CAPABILITIES_INPUT_SCHEMA.properties,
      [GET_COVERAGE_TOOL_NAME]: GET_COVERAGE_INPUT_SCHEMA.properties,
      [INSPECT_EVIDENCE_TOOL_NAME]: INSPECT_EVIDENCE_INPUT_SCHEMA.properties,
      [PREPARE_STORM_CLAIM_TOOL_NAME]: PREPARE_STORM_CLAIM_INPUT_SCHEMA.properties,
      [SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME]: SET_ENVIRONMENTAL_MAP_LAYERS_INPUT_SCHEMA.properties,
      [LOOK_UP_PLACE_LOCATION_TOOL_NAME]: LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA.properties,
    };
    for (const item of dataset) {
      expect(item.messages).toHaveLength(1);
      expect(item.messages[0].content.trim().length).toBeGreaterThan(0);
      for (const call of item.expectedCall) {
        expect(schemas).toHaveProperty(call.functionName);
        const properties = schemas[call.functionName as keyof typeof schemas];
        for (const key of Object.keys(call.arguments)) {
          expect(properties).toHaveProperty(key);
        }
        if (call.functionName === ANALYZE_HAZARD_TOOL_NAME) {
          expect(call.arguments).toHaveProperty("place");
          expect(call.arguments).toHaveProperty("hazard");
          expect(call.arguments).toHaveProperty("time");
        }
        if (call.functionName === COMPARE_HAZARD_TOOL_NAME) {
          expect(call.arguments).toHaveProperty("baseline");
          expect(call.arguments).toHaveProperty("comparison");
          expect(call.arguments).toHaveProperty("hazard");
        }
        if (call.functionName === GET_COVERAGE_TOOL_NAME) {
          expect(call.arguments).toHaveProperty("hazard");
        }
        if (call.functionName === SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME) {
          expect(call.arguments).toHaveProperty("layers");
          const layers = call.arguments.layers as Record<string, unknown>;
          expect(Object.keys(layers).length).toBeGreaterThan(0);
          for (const layer of Object.keys(layers)) {
            expect(SET_ENVIRONMENTAL_MAP_LAYERS_INPUT_SCHEMA.properties.layers.properties)
              .toHaveProperty(layer);
          }
        }
        if (call.functionName === LOOK_UP_PLACE_LOCATION_TOOL_NAME) {
          expect(call.arguments).toHaveProperty("place");
        }
      }
    }
  });

  it("gives every registered baseline and contextual tool a natural trigger case", () => {
    const calledTools = new Set(dataset.flatMap((item) =>
      item.expectedCall.map((call) => call.functionName)
    ));
    expect(calledTools).toEqual(new Set(REGISTERED_TOOL_NAMES));
    expect(dataset.find((item) => item.id === "inspect-after-custom-analysis")?.availableAfter)
      .toBe("completed_environmental_analysis");
    expect(dataset.find((item) => item.id === "prepare-claim-after-home-wind")?.availableAfter)
      .toBe("completed_home_wind_analysis");
  });

  it("requires a three-style paraphrase family for every registered tool", () => {
    const families = new Map<string, EvalCase[]>();
    for (const item of dataset) {
      if (!item.paraphraseFamily) continue;
      families.set(item.paraphraseFamily, [
        ...(families.get(item.paraphraseFamily) ?? []),
        item,
      ]);
    }

    const toolsWithParaphraseFamilies = new Set<string>();
    for (const [family, items] of families) {
      expect(items.length, `${family} needs at least three natural phrasings`)
        .toBeGreaterThanOrEqual(3);
      expect(
        new Set(items.map((item) => item.utteranceStyle)),
        `${family} must vary the form of the request`
      ).toEqual(new Set(PARAPHRASE_UTTERANCE_STYLES));

      const reference = items[0];
      expect(reference.expectedCall, `${family} must target one tool`).toHaveLength(1);
      const targetTool = reference.expectedCall[0].functionName;
      toolsWithParaphraseFamilies.add(targetTool);

      const prompts = new Set<string>();
      for (const item of items) {
        expect(item.expectedCall, `${item.id} must preserve the same intent`).toEqual(
          reference.expectedCall
        );
        expect(item.availableAfter, `${item.id} must preserve the same state prerequisite`).toBe(
          reference.availableAfter
        );
        const prompt = item.messages[0].content.trim().toLocaleLowerCase();
        expect(prompt.length).toBeGreaterThan(0);
        for (const toolName of REGISTERED_TOOL_NAMES) {
          expect(prompt, `${item.id} must not name an internal tool`).not.toContain(toolName);
        }
        prompts.add(prompt);
      }
      expect(prompts.size, `${family} must contain distinct utterances`).toBe(items.length);
    }

    expect(toolsWithParaphraseFamilies).toEqual(new Set(REGISTERED_TOOL_NAMES));
  });

  it("marks a focused case incomplete against all checked-in paraphrase families", () => {
    const summary = summarizeParaphraseFamilies(dataset, [{
      case_id: "capability-discovery",
      run: 1,
      exact_match: true,
    }], 1);

    expect(summary).toMatchObject({
      expected_cases: 24,
      expected_runs: 24,
      executed_runs: 1,
      passes: 1,
      total: 24,
      complete: false,
      all_passed: false,
    });
    expect(summary.families).toHaveLength(8);
    expect(summary.families.find((family) => family.family === "capability-discovery"))
      .toMatchObject({
        expected_case_count: 3,
        expected_runs: 3,
        executed_runs: 1,
        passes: 1,
        complete: false,
        all_passed: false,
      });
    expect(summary.missing_cases).toContainEqual({
      family: "capability-discovery",
      case_id: "capability-discovery-imperative",
      utterance_style: "imperative",
      runs: [1],
    });
  });

  it("covers every hazard with non-demo questions through the shared analysis tool", () => {
    const analyzedHazards = new Set(dataset.flatMap((item) =>
      item.expectedCall
        .filter((call) => call.functionName === ANALYZE_HAZARD_TOOL_NAME)
        .map((call) => call.arguments.hazard)
    ));
    expect(analyzedHazards).toEqual(new Set(HAZARD_IDS));
  });

  it("uses discovery only for capability questions and keeps concrete asks direct", () => {
    expect(dataset.find((item) => item.id === "capability-discovery")?.expectedCall[0])
      .toMatchObject({ functionName: CAPABILITIES_TOOL_NAME, arguments: {} });
    expect(dataset.find((item) => item.id === "coverage-discovery-air-quality")?.expectedCall[0])
      .toMatchObject({
        functionName: GET_COVERAGE_TOOL_NAME,
        arguments: { hazard: "air_quality" },
      });
    for (const id of [
      "direct-fire-place",
      "implicit-heat-pets",
      "beryl-broad-home-damage-auto-bundle",
      "los-angeles-health-demo",
      "tucson-pets-demo",
      "historical-wind-no-concern",
    ]) {
      expect(dataset.find((item) => item.id === id)?.expectedCall[0]?.functionName)
        .toBe(ANALYZE_HAZARD_TOOL_NAME);
    }
  });

  it("keeps neighboring intents distinct when their wording overlaps", () => {
    const expectedTool = (id: string) =>
      dataset.find((item) => item.id === id)?.expectedCall[0]?.functionName;

    expect(expectedTool("capability-discovery-conversational"))
      .toBe(CAPABILITIES_TOOL_NAME);
    expect(expectedTool("direct-fire-place-conversational"))
      .toBe(ANALYZE_HAZARD_TOOL_NAME);

    expect(expectedTool("coverage-discovery-air-quality-conversational"))
      .toBe(GET_COVERAGE_TOOL_NAME);
    expect(expectedTool("inspect-source-failure-follow-up"))
      .toBe(INSPECT_EVIDENCE_TOOL_NAME);

    expect(expectedTool("generic-recent-storm-related-context"))
      .toBe(ANALYZE_HAZARD_TOOL_NAME);
    expect(expectedTool("compare-generic-storm-scenarios-conversational"))
      .toBe(COMPARE_HAZARD_TOOL_NAME);

    expect(expectedTool("initial-insurer-request-needs-analysis"))
      .toBe(ANALYZE_HAZARD_TOOL_NAME);
    expect(expectedTool("prepare-claim-after-home-wind-conversational"))
      .toBe(PREPARE_STORM_CLAIM_TOOL_NAME);

    expect(expectedTool("map-neighbor-analysis-conditions-impact-safety"))
      .toBe(ANALYZE_HAZARD_TOOL_NAME);
    expect(expectedTool("map-neighbor-source-eligibility"))
      .toBe(GET_COVERAGE_TOOL_NAME);
    expect(expectedTool("place-geography-phoenix-conversational"))
      .toBe(LOOK_UP_PLACE_LOCATION_TOOL_NAME);
    expect(expectedTool("hide-surface-heat-imagery"))
      .toBe(SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME);

    const composite = dataset.find((item) => item.id === "place-and-map-composite");
    expect(composite?.expectedCall.map((call) => call.functionName)).toEqual([
      LOOK_UP_PLACE_LOCATION_TOOL_NAME,
      SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME,
    ]);
  });

  it("lets narrow historical evidence asks proceed without concern and broad goals ask first", () => {
    const narrow = dataset.find((item) => item.id === "historical-wind-no-concern");
    const broad = dataset.find((item) => item.id === "broad-goal-ask-clarification");
    expect(narrow?.expectedCall[0]).toMatchObject({
      functionName: ANALYZE_HAZARD_TOOL_NAME,
      arguments: { place: "Houston", hazard: "wind_storm" },
    });
    expect(narrow?.expectedCall[0].arguments).not.toHaveProperty("concern");
    expect(broad?.expectedCall).toEqual([]);
    expect(broad?.expectedAssistant).toEqual({
      mustAskUserToChooseHazard: true,
      mustWaitForUserReply: true,
      mayListHazardsBeforeQuestion: true,
    });
  });

  it("selects a curated demo through the existing discovery tool before analysis", () => {
    const selected = dataset.find((item) => item.id === "selected-tucson-demo");
    expect(selected?.expectedCall.map((call) => call.functionName)).toEqual([
      CAPABILITIES_TOOL_NAME,
      ANALYZE_HAZARD_TOOL_NAME,
    ]);
    expect(selected?.expectedCall[0].arguments).toEqual({});
  });

  it("uses single scope only for explicit asks and defaults broad questions to related context", () => {
    const gust = dataset.find((item) => item.id === "beryl-specific-wind-gust");
    const water = dataset.find((item) => item.id === "completed-flood-date");
    const broad = dataset.find((item) => item.id === "beryl-broad-home-damage-auto-bundle");
    const genericStorm = dataset.find((item) => item.id === "generic-recent-storm-related-context");
    const heatDrought = dataset.find((item) => item.id === "broad-heat-drought-context");
    const smokeAir = dataset.find((item) => item.id === "broad-smoke-air-context");
    const volcanoAirHeat = dataset.find((item) => item.id === "broad-volcano-air-heat-context");
    expect(gust?.expectedCall.map((call) => call.arguments.hazard)).toEqual(["wind_storm"]);
    expect(gust?.expectedCall[0].arguments.analysis_scope).toBe("single_hazard_only");
    expect(water?.expectedCall.map((call) => call.arguments.hazard)).toEqual(["flood_storm"]);
    expect(water?.expectedCall[0].arguments.analysis_scope).toBe("single_hazard_only");
    expect(broad?.expectedCall.map((call) => call.arguments.hazard)).toEqual(["wind_storm"]);
    expect(broad?.expectedCall[0].arguments.analysis_scope).toBeUndefined();
    expect(genericStorm?.expectedCall[0].arguments).toMatchObject({
      hazard: "wind_storm",
      time: "2026-08-28",
      analysis_scope: "related_context",
    });
    expect(genericStorm?.expectedCall[0].arguments.question).toContain("Was there a storm");
    expect(heatDrought?.expectedCall[0].arguments.hazard).toBe("extreme_heat");
    expect(smokeAir?.expectedCall[0].arguments.hazard).toBe("fire_smoke");
    expect(volcanoAirHeat?.expectedCall[0].arguments.hazard).toBe("earth_volcanoes");
  });
});
