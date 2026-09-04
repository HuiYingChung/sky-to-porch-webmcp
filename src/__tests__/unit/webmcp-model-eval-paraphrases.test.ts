import { describe, expect, it } from "vitest";
import {
  assertValidParaphraseMetadata,
  summarizeParaphraseFamilies,
  type ParaphraseEvalCase,
} from "../../../scripts/webmcp-model-eval-paraphrases";

function inspectFamily(): ParaphraseEvalCase[] {
  const expectedCall = [{
    functionName: "inspect_current_environmental_evidence",
    arguments: {},
  }];
  return [
    {
      id: "inspect-question",
      paraphraseFamily: "inspect-current-result",
      utteranceStyle: "question",
      expectedCall,
    },
    {
      id: "inspect-imperative",
      paraphraseFamily: "inspect-current-result",
      utteranceStyle: "imperative",
      expectedCall,
    },
    {
      id: "inspect-conversational",
      paraphraseFamily: "inspect-current-result",
      utteranceStyle: "conversational",
      expectedCall,
    },
  ];
}

describe("WebMCP paraphrase model-eval summaries", () => {
  it.each([
    {
      name: "non-string family",
      item: {
        id: "bad-family",
        paraphraseFamily: 7,
        utteranceStyle: "question",
        expectedCall: [{ functionName: "inspect", arguments: {} }],
      },
    },
    {
      name: "missing style",
      item: {
        id: "missing-style",
        paraphraseFamily: "inspect",
        expectedCall: [{ functionName: "inspect", arguments: {} }],
      },
    },
    {
      name: "style without family",
      item: {
        id: "missing-family",
        utteranceStyle: "question",
        expectedCall: [{ functionName: "inspect", arguments: {} }],
      },
    },
    {
      name: "unknown style",
      item: {
        id: "bad-style",
        paraphraseFamily: "inspect",
        utteranceStyle: "request",
        expectedCall: [{ functionName: "inspect", arguments: {} }],
      },
    },
    {
      name: "invalid expected call shape",
      item: {
        id: "bad-call",
        paraphraseFamily: "inspect",
        utteranceStyle: "question",
        expectedCall: [{ functionName: "inspect", arguments: null }],
      },
    },
  ])("rejects invalid runtime metadata: $name", ({ item }) => {
    expect(() => assertValidParaphraseMetadata([item])).toThrow();
  });

  it("marks a focused --case-style run incomplete against the full family", () => {
    const summary = summarizeParaphraseFamilies(inspectFamily(), [
      { case_id: "inspect-question", run: 1, exact_match: true },
      { case_id: "inspect-question", run: 2, exact_match: true },
    ], 2);

    expect(summary).toMatchObject({
      match_basis: "exact_call",
      expected_cases: 3,
      expected_runs: 6,
      executed_runs: 2,
      passes: 2,
      total: 6,
      complete: false,
      all_passed: false,
    });
    expect(summary.families[0]).toMatchObject({
      expected_case_count: 3,
      expected_styles: ["question", "imperative", "conversational"],
      expected_runs: 6,
      executed_runs: 2,
      passes: 2,
      complete: false,
      all_passed: false,
      missing_cases: [
        { case_id: "inspect-imperative", utterance_style: "imperative", runs: [1, 2] },
        {
          case_id: "inspect-conversational",
          utterance_style: "conversational",
          runs: [1, 2],
        },
      ],
    });
  });

  it("fails a complete family when bogus inspect arguments only match semantic scoring", () => {
    const bogusInspectOutcome = {
      case_id: "inspect-question",
      run: 1,
      exact_match: false,
      semantic_match: true,
      actual_calls: [{
        functionName: "inspect_current_environmental_evidence",
        arguments: { bogus: true },
      }],
    };
    const summary = summarizeParaphraseFamilies(inspectFamily(), [
      bogusInspectOutcome,
      { case_id: "inspect-imperative", run: 1, exact_match: true },
      { case_id: "inspect-conversational", run: 1, exact_match: true },
    ], 1);

    expect(summary).toMatchObject({
      expected_runs: 3,
      executed_runs: 3,
      passes: 2,
      complete: true,
      all_passed: false,
      failed_cases: [{
        family: "inspect-current-result",
        case_id: "inspect-question",
        utterance_style: "question",
        runs: [1],
      }],
    });
  });

  it("passes only when every expected case and run has an exact call", () => {
    const summary = summarizeParaphraseFamilies(inspectFamily(), [
      { case_id: "inspect-question", run: 1, exact_match: true },
      { case_id: "inspect-imperative", run: 1, exact_match: true },
      { case_id: "inspect-conversational", run: 1, exact_match: true },
    ], 1);

    expect(summary).toMatchObject({
      expected_runs: 3,
      executed_runs: 3,
      passes: 3,
      complete: true,
      all_passed: true,
      failed_cases: [],
      missing_cases: [],
    });
  });
});
