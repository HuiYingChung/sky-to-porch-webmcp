import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AboutDialog } from "@/components/about/about-dialog";
import {
  SOURCE_COVERAGE_PROFILES,
  coverageProfileRegistryEntry,
} from "@/data/source-coverage";

describe("evidence coverage catalog and About surface", () => {
  it("keeps one truthful profile per registered source", () => {
    const ids = SOURCE_COVERAGE_PROFILES.map((profile) => profile.sourceId);
    expect(new Set(ids).size).toBe(ids.length);

    for (const profile of SOURCE_COVERAGE_PROFILES) {
      const registry = coverageProfileRegistryEntry(profile.sourceId);
      expect(registry).toBeDefined();
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

  it("does not mislabel smoke polygons as AQI and has one combined Canada GeoMet profile", () => {
    expect(
      SOURCE_COVERAGE_PROFILES.find((profile) => profile.sourceId === "noaa_hms_smoke_polygons")?.hazardIds
    ).toEqual(["fire_smoke"]);
    expect(
      SOURCE_COVERAGE_PROFILES.filter((profile) => profile.sourceId === "canada_geomet")
    ).toHaveLength(1);
    expect(
      SOURCE_COVERAGE_PROFILES.find((profile) => profile.sourceId === "canada_geomet")?.hazardIds
    ).toEqual(expect.arrayContaining(["flood_storm", "extreme_heat", "air_quality"]));
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
        evidenceRole: "supporting",
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
    expect(ghcnh?.liveGateNote).toMatch(/ADR-0039/);
    expect(ghcnh?.temporalCoverage).toMatch(/four weeks/i);
    expect(ghcnh?.coverageNote).toMatch(/no heat index/i);
  });

  it("registers the NOAA Storm Events supporting profile without claiming a live path", () => {
    const storm = SOURCE_COVERAGE_PROFILES.find(
      (profile) => profile.sourceId === "noaa_ncei_storm_events"
    );
    expect(storm).toMatchObject({
      hazardIds: ["flood_storm"],
      level: "national",
      kind: "official_event",
      integrationStatus: "supporting_only",
      evidenceRole: "supporting",
      countryCodes: ["US"],
    });
    expect(storm?.liveGateNote).toMatch(/no live gate/i);
    expect(storm?.coverageNote).toMatch(/never prove/i);
  });

  it("derives the primary-gap summary from profile statuses instead of hand-written claims", () => {
    const html = renderToStaticMarkup(<AboutDialog open onRequestClose={vi.fn()} />);
    expect(html).toContain("Current primary gaps");
    // ADR-0047: the summary is status-grouped rows, not one wall paragraph.
    expect(html).toContain("Documented contract, live gate not yet run:");
    expect(html).toContain("Registered research candidates, no supported machine contract:");
    expect(html).toContain("Historical supporting context, no live path:");
    // The stale hand-written claims must be gone: GHCNh is live (ADR-0039)
    // and the USCRN allowlist is nationwide (ADR-0037), not Tucson-only.
    expect(html).not.toContain("still failed its");
    expect(html).not.toContain("currently Tucson");
    // Every non-live profile is named in the derived summary.
    for (const profile of SOURCE_COVERAGE_PROFILES) {
      if (
        profile.integrationStatus === "prepared_for_live" ||
        profile.integrationStatus === "registered_deferred" ||
        profile.integrationStatus === "supporting_only"
      ) {
        expect(html).toContain(coverageProfileRegistryEntry(profile.sourceId)!.displayName);
      }
    }
    // The derived summary points at the newest recorded gate date.
    expect(html).toContain("most recent:");
    expect(html).toContain("2026-08-18");
  });

  it("keeps lastVerifiedDate a real evidence-cited UTC date where present", () => {
    const airNowDaily = SOURCE_COVERAGE_PROFILES.find(
      (profile) => profile.sourceId === "airnow_daily_data"
    );
    expect(airNowDaily?.lastVerifiedDate).toBe("2026-08-15");
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
    expect(html).toContain("Satellite data");
    expect(html).toContain("North America");
    expect(html).toContain("It does not mean no danger");
    expect(html).toContain("not rejected merely because it is outside a demo city");
    expect(html).toContain("Current primary gaps");
    expect(html).toContain("Fire &amp; Smoke");
    expect(html).toContain("Drought &amp; Land");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Official source documentation");
    expect(html).toContain("Last verified");
    expect(html).toContain("2026-08-18 (bounded gate)");
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
    expect(html).toContain('href="https://github.com/HuiYingChung/sky-to-porch"');
    // Both leave the app, so both must be safe external links.
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
