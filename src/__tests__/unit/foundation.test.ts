import { describe, it, expect } from "vitest";
import { isIntegrationConfigured } from "@/lib/foundation";

describe("foundation", () => {
  it("returns false for any integration at foundation stage", () => {
    expect(isIntegrationConfigured("nasa-firms")).toBe(false);
    expect(isIntegrationConfigured("ibm-watsonx")).toBe(false);
    expect(isIntegrationConfigured("noaa")).toBe(false);
  });
});
