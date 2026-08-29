import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HAZARD_IDS } from "@/contracts/common";
import {
  ANALYZE_HAZARD_INPUT_SCHEMA,
  ANALYZE_HAZARD_TOOL_NAME,
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

interface EvalCall {
  functionName: string;
  arguments: Record<string, unknown>;
}

interface EvalCase {
  id: string;
  availableAfter?: "completed_environmental_analysis" | "completed_home_wind_analysis";
  messages: Array<{ role: "user"; content: string }>;
  expectedCall: EvalCall[];
  expectedAssistant?: {
    mustAskUserToChooseHazard?: boolean;
    mustWaitForUserReply?: boolean;
    mayListHazardsBeforeQuestion?: boolean;
  };
}

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
  };
}

describe("WebMCP tool-selection eval dataset", () => {
  const dataset = JSON.parse(readFileSync(resolve(
    process.cwd(),
    "tests/webmcp/tool-selection-evals.json"
  ), "utf8")) as EvalCase[];
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
    expect(postToolDataset).toHaveLength(4);
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
      [CAPABILITIES_TOOL_NAME]: CAPABILITIES_INPUT_SCHEMA.properties,
      [GET_COVERAGE_TOOL_NAME]: GET_COVERAGE_INPUT_SCHEMA.properties,
      [INSPECT_EVIDENCE_TOOL_NAME]: INSPECT_EVIDENCE_INPUT_SCHEMA.properties,
      [PREPARE_STORM_CLAIM_TOOL_NAME]: PREPARE_STORM_CLAIM_INPUT_SCHEMA.properties,
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
        if (call.functionName === GET_COVERAGE_TOOL_NAME) {
          expect(call.arguments).toHaveProperty("hazard");
        }
      }
    }
  });

  it("gives every registered baseline and contextual tool a natural trigger case", () => {
    const calledTools = new Set(dataset.flatMap((item) =>
      item.expectedCall.map((call) => call.functionName)
    ));
    expect(calledTools).toEqual(new Set([
      ANALYZE_HAZARD_TOOL_NAME,
      CAPABILITIES_TOOL_NAME,
      GET_COVERAGE_TOOL_NAME,
      INSPECT_EVIDENCE_TOOL_NAME,
      PREPARE_STORM_CLAIM_TOOL_NAME,
    ]));
    expect(dataset.find((item) => item.id === "inspect-after-custom-analysis")?.availableAfter)
      .toBe("completed_environmental_analysis");
    expect(dataset.find((item) => item.id === "prepare-claim-after-home-wind")?.availableAfter)
      .toBe("completed_home_wind_analysis");
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
