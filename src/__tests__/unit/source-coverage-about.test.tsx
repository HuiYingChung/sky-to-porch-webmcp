import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AboutDialog } from "@/components/about/about-dialog";
import {
  SOURCE_COVERAGE_PROFILES,
  coverageProfileRegistryEntry,
} from "@/data/source-coverage";

function renderAboutText(): string {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<AboutDialog open onRequestClose={vi.fn()} />);
  return container.textContent ?? "";
}

describe("evidence coverage catalog and About surface", () => {
  it("keeps one truthful profile per registered source", () => {
    const ids = SOURCE_COVERAGE_PROFILES.map((profile) => profile.sourceId);
    expect(new Set(ids).size).toBe(ids.length);

    for (const profile of SOURCE_COVERAGE_PROFILES) {
      const registry = coverageProfileRegistryEntry(profile.sourceId);
      expect(registry).toBeDefined();
      expect(profile.publicName.trim()).not.toBe("");
      expect(profile.hazardIds.length).toBeGreaterThan(0);
      for (const hazardId of profile.hazardIds) {
        expect(registry?.hazardIds).toContain(hazardId);
      }
      if (profile.integrationStatus === "live_integrated" || profile.integrationStatus === "live_key_required") {
        expect(registry?.supportedDataModes).toContain("live");
      }
      if (profile.kind === "satellite") expect(profile.satellite).toBeDefined();
    }
  });

  it("does not mislabel smoke polygons as AQI and scopes live Canada GeoMet to Flood", () => {
    expect(
      SOURCE_COVERAGE_PROFILES.find((profile) => profile.sourceId === "noaa_hms_smoke_polygons")?.hazardIds
    ).toEqual(["fire_smoke"]);
    expect(
      SOURCE_COVERAGE_PROFILES.filter((profile) => profile.sourceId === "canada_geomet")
    ).toHaveLength(1);
    expect(
      SOURCE_COVERAGE_PROFILES.find((profile) => profile.sourceId === "canada_geomet")?.hazardIds
    ).toEqual(["flood_storm"]);
    expect(
      SOURCE_COVERAGE_PROFILES.find((profile) => profile.sourceId === "canada_geomet")
    ).toMatchObject({ integrationStatus: "live_integrated", countryCodes: ["CA"] });
  });

  it("separates the global drought satellite path from nationwide regional confirmation", () => {
    const gibs = SOURCE_COVERAGE_PROFILES.find(
      (profile) => profile.sourceId === "nasa_gibs_modis_ndvi_16day"
    );
    const usdm = SOURCE_COVERAGE_PROFILES.find(
      (profile) => profile.sourceId === "us_drought_monitor_rest"
    );
    expect(gibs).toMatchObject({ level: "global", kind: "satellite", integrationStatus: "live_integrated" });
    expect(gibs?.liveGateNote).toMatch(/New York smoke passed/i);
    expect(usdm).toMatchObject({
      level: "national",
      countryCodes: ["US"],
      integrationStatus: "live_integrated",
    });
    expect(usdm?.coverageNote).toMatch(/state or territory.*never property-scale/i);
  });

  it("marks AirNow daily data live without turning one Houston gate into coverage proof", () => {
    const airNowDaily = SOURCE_COVERAGE_PROFILES.find(
      (profile) => profile.sourceId === "airnow_daily_data"
    );
    expect(airNowDaily).toMatchObject({
      level: "national",
      kind: "ground_station",
      integrationStatus: "live_integrated",
      evidenceRole: "supporting",
    });
    expect(airNowDaily?.liveGateNote).toMatch(/one Houston historical-date cell/i);
    expect(airNowDaily?.liveGateNote).toMatch(/not.*nationwide station coverage proof/i);
  });

  it("reflects the verified 2026-08-18 WP-12 live gates without pending wording", () => {
    for (const sourceId of ["usgs_volcano_hans", "usgs_earthquake_geojson"] as const) {
      const profile = SOURCE_COVERAGE_PROFILES.find((item) => item.sourceId === sourceId);
      expect(profile).toMatchObject({
        integrationStatus: "live_integrated",
        evidenceRole: "primary",
        lastVerifiedDate: "2026-08-18",
      });
      expect(profile?.liveGateNote).toMatch(/2026-08-18/);
      expect(profile?.liveGateNote).not.toMatch(/pending/i);
      expect(profile?.liveGateNote).toMatch(/never.*prediction|never prediction/i);
    }
    const earthquake = SOURCE_COVERAGE_PROFILES.find(
      (item) => item.sourceId === "usgs_earthquake_geojson"
    );
    expect(earthquake?.liveGateNote).toMatch(/not nationwide coverage proof/i);
  });

  it("lists the ADR-0037 USCRN allowlist without overclaiming metro station coverage", () => {
    const uscrn = SOURCE_COVERAGE_PROFILES.find(
      (profile) => profile.sourceId === "noaa_uscrn_heat_exposure"
    );
    expect(uscrn).toMatchObject({
      hazardIds: ["extreme_heat"],
      level: "national",
      kind: "ground_station",
      integrationStatus: "live_integrated",
      evidenceRole: "supporting",
      countryCodes: ["US"],
    });
    expect(uscrn?.regionLabel).toMatch(/156 operational allowlisted USCRN/i);
    expect(uscrn?.coverageNote).toMatch(/never indoor/i);
    expect(uscrn?.liveGateNote).toMatch(/ADR-0037/);
    expect(uscrn?.liveGateNote).toMatch(/nearest to the selected area center/i);
    // Rural siting means many metros have no in-box station; say so.
    expect(uscrn?.spatialResolution).toMatch(/no station inside a selected box/i);
    // ADR-0039: the nationwide GHCNh family is wired for historical dates.
    const ghcnh = SOURCE_COVERAGE_PROFILES.find(
      (profile) => profile.sourceId === "noaa_ncei_global_hourly"
    );
    expect(ghcnh?.integrationStatus).toBe("live_integrated");
    expect(ghcnh?.level).toBe("global");
    expect(ghcnh?.regionLabel).toMatch(/Global GHCNh/i);
    expect(ghcnh?.temporalCoverage).toMatch(/four weeks/i);
    expect(ghcnh?.coverageNote).toMatch(/no heat index/i);
  });

  it("registers the NOAA Storm Events production historical adapter", () => {
    const storm = SOURCE_COVERAGE_PROFILES.find(
      (profile) => profile.sourceId === "noaa_ncei_storm_events"
    );
    expect(storm).toMatchObject({
      hazardIds: ["flood_storm", "wind_storm"],
      level: "national",
      kind: "official_event",
      integrationStatus: "live_integrated",
      evidenceRole: "supporting",
      countryCodes: ["US"],
    });
    expect(storm?.liveGateNote).toMatch(/annual details publication/i);
    expect(storm?.liveGateNote).toMatch(/coordinates inside the selected geometry/i);
    expect(storm?.coverageNote).toMatch(/never prove/i);
  });

  it("derives the plain-language availability summary from profile statuses", () => {
    const html = renderToStaticMarkup(<AboutDialog open onRequestClose={vi.fn()} />);
    expect(html).toContain("Availability at a glance");
    // ADR-0047: the summary is status-grouped rows, not one wall paragraph.
    expect(html).toContain("Needs setup:");
    expect(html).toContain("Not available yet:");
    expect(html).toContain("Background information only:");
    // The stale hand-written claims must be gone: GHCNh is live (ADR-0039)
    // and the USCRN allowlist is nationwide (ADR-0037), not Tucson-only.
    expect(html).not.toContain("still failed its");
    expect(html).not.toContain("currently Tucson");
    // Every source that cannot be used immediately is named in the derived summary.
    for (const profile of SOURCE_COVERAGE_PROFILES) {
      if (
        profile.integrationStatus === "live_key_required" ||
        profile.integrationStatus === "prepared_for_live" ||
        profile.integrationStatus === "registered_deferred" ||
        profile.integrationStatus === "supporting_only"
      ) {
        expect(html).toContain(profile.publicName);
      }
    }
    // The derived summary points at the newest recorded connection-check date.
    expect(html).toContain("recorded connection-check date");
    expect(html).toContain("Sep 4, 2026");
  });

  it("keeps lastVerifiedDate a real evidence-cited UTC date where present", () => {
    const expectedChecks = {
      noaa_hms_fire_points: "2026-08-27",
      noaa_hms_smoke_polygons: "2026-08-27",
      nasa_lance_flood_extent: "2026-08-30",
      nws_tropical_cyclone_report: "2026-08-27",
      nasa_gibs_imerg: "2026-08-30",
      usgs_instantaneous_values: "2026-08-30",
      nws_local_storm_reports: "2026-08-30",
      nasa_gibs_modis_lst_day: "2026-08-27",
      noaa_uscrn_heat_exposure: "2026-08-27",
      noaa_ncei_global_hourly: "2026-08-30",
      nasa_gibs_modis_ndvi_16day: "2026-08-27",
      us_drought_monitor_rest: "2026-08-27",
      nasa_gibs_modis_aod: "2026-08-27",
      airnow_daily_data: "2026-08-27",
    } as const;
    for (const [sourceId, date] of Object.entries(expectedChecks)) {
      expect(SOURCE_COVERAGE_PROFILES.find(
        (profile) => profile.sourceId === sourceId
      )?.lastVerifiedDate).toBe(date);
    }
    for (const profile of SOURCE_COVERAGE_PROFILES) {
      if (profile.lastVerifiedDate === undefined) continue;
      expect(profile.lastVerifiedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("renders compact, collapsed coverage disclosure with a separate Satellite data category", () => {
    const html = renderToStaticMarkup(
      <AboutDialog open onRequestClose={vi.fn()} />
    );
    expect(html).toContain("About Sky to Porch");
    expect(html).toContain("Coverage");
    expect(html).toContain("Satellite data");
    expect(html).toContain("North America");
    expect(html).toContain("It does not mean no danger");
    expect(html).toContain("not rejected merely because it is outside a demo city");
    expect(html).toContain("Availability at a glance");
    expect(html).toContain("Fire &amp; Smoke");
    expect(html).toContain("Drought &amp; Land");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Official source documentation");
    expect(html).toContain("Last verified");
    expect(html).toContain("Aug 18, 2026");
    expect(html).not.toContain("remains pending");
    expect(html).not.toContain("still pending");
    // ADR-0047: bulk controls for the collapsed-by-default cards.
    expect(html).toContain("about-expand-all");
    expect(html).toContain("about-collapse-all");
    expect(html).toContain("Expand all");
    expect(html).toContain("Collapse all");
    // ADR-0047: lead paragraphs carry scannable small headings.
    expect(html).toContain("How coverage is evaluated");
    expect(html).toContain("What a no-observation result means");
  });

  it("keeps internal identifiers and release-check language out of the readable catalog", () => {
    const text = renderAboutText();

    for (const profile of SOURCE_COVERAGE_PROFILES) {
      expect(text).toContain(profile.publicName);
      expect(text).not.toContain(profile.sourceId);
      expect(text).not.toContain(profile.liveGateNote);
    }

    expect(text).not.toMatch(/\b(?:Sources?|Observation IDs?|Evidence IDs?|Hash)\s*:/i);
    expect(text).not.toMatch(/\b(?:obs|evd|intent|lim|src)-[a-z0-9_-]+\b/i);
    expect(text).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
    expect(text).not.toMatch(/\b[0-9a-f]{32,}\b/i);
    expect(text).not.toMatch(/\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz)\b/i);
    expect(text).toContain("Live integrated");
    expect(text).toContain("Live · server key required");
    expect(text).toContain("Prepared · live smoke pending");
    expect(text).toContain("Registered candidate");
    expect(text).toContain("Supporting only");
    expect(text).toContain("Needs setup");
    expect(text).toContain("Not available yet");
    expect(text).toContain("Background information");
  });

  it("states what the product is, why it can be trusted, and what it refuses (ADR-0051)", () => {
    const html = renderToStaticMarkup(<AboutDialog open onRequestClose={vi.fn()} />);
    // What it is.
    expect(html).toContain("turns official satellite and ground observations into a plain");
    // Why it can be trusted: sources, times, and the no-data boundary.
    expect(html).toContain("names the datasets behind it");
    expect(html).toContain("reported as missing, never");
    // What it refuses. These three are the product's standing boundary and
    // must not quietly disappear from the one surface that introduces it.
    expect(html).toContain("does not predict");
    expect(html).toContain("inside a specific building");
    expect(html).toContain("does not replace official alerts");
  });

  it("disclaims agency affiliation and names its author (ADR-0053)", () => {
    const html = renderToStaticMarkup(<AboutDialog open onRequestClose={vi.fn()} />);
    // The app shows NASA, NOAA, and USGS material on every surface, so the
    // one page that introduces it must say whose project this is not.
    expect(html).toContain("independent project");
    expect(html).toContain("not affiliated with, endorsed by, or operated by NASA");
    // ADR-0053: the in-app line must state the same licence as LICENSE and
    // the README. "All rights reserved" was the pre-LICENSE default and
    // contradicted the README's grant once one existed.
    expect(html).toContain("Personal and educational use only");
    // The byline is the portfolio link: a page about evidence should not
    // carry a separate pitch, and a name leading to its author's work is the
    // convention.
    expect(html).toContain('href="https://www.huiyingchung.com/"');
    expect(html).toContain("Huiying Chung ↗");
    expect(html).toContain(
      'href="https://github.com/HuiYingChung/sky-to-porch-webmcp"',
    );
    // Both leave the app, so both must be safe external links.
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
