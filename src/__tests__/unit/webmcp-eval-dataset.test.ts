import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANALYZE_HAZARD_INPUT_SCHEMA,
  ANALYZE_HAZARD_TOOL_NAME,
} from "@/lib/webmcp/analyze-tool";

interface EvalCall {
  functionName: string;
  arguments: Record<string, unknown>;
}

interface EvalCase {
  id: string;
  messages: Array<{ role: "user"; content: string }>;
  expectedCall: EvalCall[];
}

describe("WebMCP tool-selection eval dataset", () => {
  const dataset = JSON.parse(readFileSync(resolve(
    process.cwd(),
    "tests/webmcp/tool-selection-evals.json"
  ), "utf8")) as EvalCase[];

  it("has unique bounded cases including an out-of-scope no-call", () => {
    expect(dataset.length).toBeGreaterThanOrEqual(6);
    expect(new Set(dataset.map((item) => item.id)).size).toBe(dataset.length);
    expect(dataset.some((item) => item.expectedCall.length === 0)).toBe(true);
    expect(dataset.some((item) => item.id.includes("ambiguous"))).toBe(true);
  });

  it("keeps expected calls aligned with the registered tool contract", () => {
    const properties = ANALYZE_HAZARD_INPUT_SCHEMA.properties;
    for (const item of dataset) {
      expect(item.messages).toHaveLength(1);
      expect(item.messages[0].content.trim().length).toBeGreaterThan(0);
      for (const call of item.expectedCall) {
        expect(call.functionName).toBe(ANALYZE_HAZARD_TOOL_NAME);
        expect(call.arguments).toHaveProperty("place");
        expect(call.arguments).toHaveProperty("hazard");
        for (const key of Object.keys(call.arguments)) {
          expect(properties).toHaveProperty(key);
        }
      }
    }
  });

  it("uses a narrow wind chain for a gust question and auto-bundles broad storm damage", () => {
    const gust = dataset.find((item) => item.id === "beryl-specific-wind-gust");
    const water = dataset.find((item) => item.id === "completed-flood-date");
    const broad = dataset.find((item) => item.id === "beryl-broad-home-damage-auto-bundle");
    expect(gust?.expectedCall.map((call) => call.arguments.hazard)).toEqual(["wind_storm"]);
    expect(water?.expectedCall.map((call) => call.arguments.hazard)).toEqual(["flood_storm"]);
    expect(broad?.expectedCall.map((call) => call.arguments.hazard)).toEqual(["storm_impacts"]);
  });
});
