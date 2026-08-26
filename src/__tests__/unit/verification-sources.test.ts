import { describe, expect, it } from "vitest";
import { validateAdaptiveMeaning } from "@/contracts/meaning";
import {
  VERIFICATION_SOURCES,
  defaultVerificationSourceIds,
  eligibleVerificationSources,
  getVerificationSource,
} from "@/data/verification-sources";

describe("official verification-source catalog", () => {
  it("contains only fixed official HTTPS links with explicit coverage and limitations", () => {
    expect(VERIFICATION_SOURCES.length).toBeGreaterThan(5);
    for (const source of VERIFICATION_SOURCES) {
      const url = new URL(source.url);
      expect(url.protocol).toBe("https:");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(source.owner.length).toBeGreaterThan(3);
      expect(source.coverageLabel.length).toBeGreaterThan(3);
      expect(source.limitation.length).toBeGreaterThan(10);
      expect(["2026-08-13", "2026-08-14", "2026-08-20"]).toContain(source.lastVerifiedAt);
      expect(getVerificationSource(source.id)).toBe(source);
    }
  });

  it("recommends concern-aware official checks without inventing a flood extent source", () => {
    expect(defaultVerificationSourceIds("extreme_heat", "pets")).toEqual([
      "nws_weather",
      "cdc_heat_pets",
      "epa_airnow",
    ]);
    // Heat travel plans get official forward-looking checks (HeatRisk,
    // heat.gov), and every other heat concern carries the HeatRisk outlook.
    expect(defaultVerificationSourceIds("extreme_heat", "travel")).toEqual([
      "nws_weather",
      "nws_heatrisk",
      "heat_gov",
    ]);
    expect(defaultVerificationSourceIds("extreme_heat", "home")).toEqual([
      "nws_weather",
      "nws_heatrisk",
    ]);
    expect(getVerificationSource("nws_heatrisk").url)
      .toBe("https://www.wpc.ncep.noaa.gov/heatrisk/");
    expect(getVerificationSource("heat_gov").url).toBe("https://www.heat.gov/");
    expect(defaultVerificationSourceIds("flood_storm", "travel")).toEqual([
      "noaa_nwps",
      "nasa_lance_flood_viewer",
    ]);
    expect(eligibleVerificationSources("flood_storm", "travel").map((source) => source.id))
      .not.toContain("epa_airnow");
    expect(eligibleVerificationSources("flood_storm", "travel").map((source) => source.id))
      .not.toContain("houston_transtar_traffic");
    expect(eligibleVerificationSources(
      "flood_storm",
      "travel",
      ["greater_houston"]
    ).map((source) => source.id)).toEqual(expect.arrayContaining([
      "houston_transtar_traffic",
      "houston_transtar_speed_archive",
    ]));
    expect(eligibleVerificationSources("flood_storm", "home").map((source) => source.id))
      .toContain("noaa_storm_events");
    expect(getVerificationSource("noaa_storm_events").url)
      .toBe("https://www.ncei.noaa.gov/stormevents/");
    expect(getVerificationSource("houston_transtar_traffic").url)
      .toBe("https://traffic.houstontranstar.org/layers/?hl=en-US");
    expect(getVerificationSource("houston_transtar_speed_archive").url)
      .toBe("https://traffic.houstontranstar.org/map_archive/");
  });
});

describe("adaptive Meaning contract", () => {
  it("accepts flexible sections and registered checker IDs", () => {
    const meaning = {
      answerMode: "direct_question",
      directAnswer: "The available regional heat evidence suggests extra care for outdoor pet activity.",
      sections: [
        {
          kind: "rationale",
          heading: "Why",
          body: "The selected evidence describes outdoor regional conditions and does not assess one animal.",
        },
        {
          kind: "next_step",
          heading: "Check before going out",
          body: "Use the official local forecast and pet heat guidance for current conditions.",
        },
      ],
      verificationSourceIds: ["nws_weather", "cdc_heat_pets"],
    } as const;

    expect(() => validateAdaptiveMeaning(meaning)).not.toThrow();
  });

  it("rejects model-authored URLs and unregistered source IDs", () => {
    expect(() => validateAdaptiveMeaning({
      answerMode: "direct_question",
      directAnswer: "Open https://example.com for a definitive answer.",
      sections: [{ kind: "next_step", heading: "Next", body: "Check another site." }],
      verificationSourceIds: [],
    })).toThrow(/verification source IDs/iu);

    expect(() => validateAdaptiveMeaning({
      answerMode: "direct_question",
      directAnswer: "Use an official checker for current conditions.",
      sections: [{ kind: "next_step", heading: "Next", body: "Check current conditions." }],
      verificationSourceIds: ["search_the_web"],
    })).toThrow(/unregistered/iu);
  });
});
