"use client";

import { useEffect, useRef, useState } from "react";
import type { HazardId } from "@/contracts/common";
import type { SourceCoverageProfile } from "@/contracts/source-coverage";
import {
  COVERAGE_STATUS_LABELS,
  HAZARD_LABELS,
  SOURCE_COVERAGE_PROFILES,
  coverageProfileRegistryEntry,
} from "@/data/source-coverage";

type AboutSection = "coverage" | "satellite" | "north-america";

const ABOUT_SECTIONS: readonly { id: AboutSection; label: string }[] = [
  { id: "coverage", label: "Coverage" },
  { id: "satellite", label: "Satellite data" },
  { id: "north-america", label: "North America" },
];

const HAZARD_ORDER = Object.keys(HAZARD_LABELS) as HazardId[];
const LIVE_STATUSES = new Set<SourceCoverageProfile["integrationStatus"]>([
  "live_integrated",
  "live_key_required",
]);

function isLive(profile: SourceCoverageProfile): boolean {
  return LIVE_STATUSES.has(profile.integrationStatus);
}

function sourceDisplayName(profile: SourceCoverageProfile): string {
  return coverageProfileRegistryEntry(profile.sourceId)?.displayName ?? profile.sourceId;
}

function joinNames(profiles: readonly SourceCoverageProfile[]): string {
  const names = profiles.map(sourceDisplayName);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The gap summary is derived from SOURCE_COVERAGE_PROFILES so it can never
 * drift from the per-source integration status the rest of the dialog shows.
 * Only the closing epistemic boundary sentence is fixed text.
 */
function GapSummary() {
  const prepared = SOURCE_COVERAGE_PROFILES.filter(
    (profile) => profile.integrationStatus === "prepared_for_live"
  );
  const deferred = SOURCE_COVERAGE_PROFILES.filter(
    (profile) => profile.integrationStatus === "registered_deferred"
  );
  const supportingOnly = SOURCE_COVERAGE_PROFILES.filter(
    (profile) => profile.integrationStatus === "supporting_only"
  );
  const liveCount = SOURCE_COVERAGE_PROFILES.filter(isLive).length;
  const latestVerified = SOURCE_COVERAGE_PROFILES
    .filter((profile) => profile.lastVerifiedDate !== undefined)
    .sort((left, right) => right.lastVerifiedDate!.localeCompare(left.lastVerifiedDate!));
  return (
    <div className="about-gap-summary">
      <h3>Current primary gaps</h3>
      <ul className="about-gap-list">
        {prepared.length > 0 && (
          <li>
            <strong className="about-gap-label-prepared">Documented contract, live gate not yet run:</strong>{" "}
            {joinNames(prepared)}.
          </li>
        )}
        {deferred.length > 0 && (
          <li>
            <strong>Registered research candidates, no supported machine contract:</strong>{" "}
            {joinNames(deferred)}.
          </li>
        )}
        {supportingOnly.length > 0 && (
          <li>
            <strong>Historical supporting context, no live path:</strong>{" "}
            {joinNames(supportingOnly)}.
          </li>
        )}
      </ul>
      <p className="about-lead">
        The other {liveCount} of {SOURCE_COVERAGE_PROFILES.length} listed sources are live,
        bounded product paths.
        {latestVerified.length > 0
          ? ` Each source card shows its own "Last verified" gate date where one is recorded (most recent: ${sourceDisplayName(latestVerified[0])}, ${latestVerified[0].lastVerifiedDate}).`
          : ""}
      </p>
      <p className="about-lead">
        Coverage remains location- and date-dependent, a missing observation is never proof of
        safety, and earthquake or eruption-timing prediction remains out of scope.
      </p>
    </div>
  );
}

function SourceDetails({ profile }: { profile: SourceCoverageProfile }) {
  const registry = coverageProfileRegistryEntry(profile.sourceId);
  return (
    <details className="about-source-card" data-source-id={profile.sourceId}>
      <summary>
        <span>
          <strong>{registry?.displayName ?? profile.sourceId}</strong>
          <small>{profile.regionLabel}</small>
        </span>
        <span className="about-status" data-status={profile.integrationStatus}>
          {COVERAGE_STATUS_LABELS[profile.integrationStatus]}
        </span>
      </summary>
      <div className="about-source-body">
        <p>{profile.coverageNote}</p>
        <dl>
          <div><dt>Hazards</dt><dd>{profile.hazardIds.map((id) => HAZARD_LABELS[id]).join(", ")}</dd></div>
          <div><dt>Resolution</dt><dd>{profile.spatialResolution}</dd></div>
          <div><dt>Update</dt><dd>{profile.updateCadence}</dd></div>
          <div><dt>Time range</dt><dd>{profile.temporalCoverage}</dd></div>
          {profile.satellite ? (
            <div>
              <dt>Satellite product</dt>
              <dd>{profile.satellite.platform} · {profile.satellite.sensor} · {profile.satellite.product}</dd>
            </div>
          ) : null}
          {profile.lastVerifiedDate ? (
            <div>
              <dt>Last verified</dt>
              <dd>{profile.lastVerifiedDate} (bounded gate)</dd>
            </div>
          ) : null}
        </dl>
        <p className="about-gate"><strong>Integration gate:</strong> {profile.liveGateNote}</p>
        {registry?.requiredLimitations[0] ? (
          <p className="about-limit"><strong>Key limitation:</strong> {registry.requiredLimitations[0]}</p>
        ) : null}
        {registry ? (
          <a href={registry.documentationUrl} target="_blank" rel="noreferrer">
            Official source documentation ↗
          </a>
        ) : null}
      </div>
    </details>
  );
}

function CoverageSection() {
  return (
    <div className="about-section-stack">
      <div className="about-lead-block">
        <h3>How coverage is evaluated</h3>
        <p className="about-lead">
          Coverage is evaluated for the selected area, selected hazard, and supported date. Any valid
          U.S. selection, including Alaska, Hawaii, Puerto Rico, and supported territories, uses the
          same atomic bounding box whether it came from map, search, or a non-map control. A place is
          not rejected merely because it is outside a demo city.
        </p>
      </div>
      <div className="about-lead-block">
        <h3>What a no-observation result means</h3>
        <p className="about-lead">
          A valid no-observation result means the source returned no usable observation for that
          request. It does not mean no danger. Source failure, stale data, and unsupported coverage
          remain separate visible states, and ground confirmation may be unavailable even when a
          satellite observation exists.
        </p>
      </div>
      <GapSummary />
      <div className="about-status-key" aria-label="Coverage status meanings">
        <span><strong>Live</strong> product route exists</span>
        <span><strong>Prepared</strong> contract identified · gate not yet run</span>
        <span><strong>Candidate</strong> research only</span>
      </div>
      <div className="about-hazard-grid">
        {HAZARD_ORDER.map((hazardId) => {
          const profiles = SOURCE_COVERAGE_PROFILES.filter((profile) =>
            profile.hazardIds.includes(hazardId)
          );
          const liveCount = profiles.filter(isLive).length;
          return (
            <details className="about-hazard-card" key={hazardId}>
              <summary>
                <span>{HAZARD_LABELS[hazardId]}</span>
                <small>{liveCount > 0 ? `${liveCount} live path${liveCount === 1 ? "" : "s"}` : "No live path yet"}</small>
              </summary>
              <div className="about-card-list">
                {profiles.map((profile) => <SourceDetails key={profile.sourceId} profile={profile} />)}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function SatelliteSection() {
  const satelliteProfiles = SOURCE_COVERAGE_PROFILES.filter((profile) => profile.satellite);
  return (
    <div className="about-section-stack">
      <p className="about-lead">
        Satellite data is a separate evidence category, not decorative mission content. It can show
        thermal anomalies, rain, surface temperature, vegetation, aerosol, or flood extent only
        when the named product supports that observation.
      </p>
      <div className="about-card-list">
        {satelliteProfiles.map((profile) => <SourceDetails key={profile.sourceId} profile={profile} />)}
      </div>
    </div>
  );
}

function NorthAmericaSection() {
  const profiles = SOURCE_COVERAGE_PROFILES.filter(
    (profile) =>
      profile.level === "global" ||
      profile.level === "north_america" ||
      profile.countryCodes.some((code) => code === "US" || code === "CA" || code === "MX")
  );
  const liveCount = profiles.filter(isLive).length;
  return (
    <div className="about-section-stack">
      <p className="about-lead">
        North America is the first coverage target: global satellite baselines are supplemented by
        U.S., Canadian, and Mexican official sources. U.S. acceptance cases include the contiguous
        states, Alaska, Hawaii, Puerto Rico, territories, coasts, borders, and sparse-station areas,
        but each hazard/date can still return no observation, unsupported coverage, stale data, or a
        truthful source failure. Today, {liveCount} listed paths are live in the product; the rest remain
        visibly prepared or deferred until their own gate passes.
      </p>
      <div className="about-card-list">
        {profiles.map((profile) => <SourceDetails key={profile.sourceId} profile={profile} />)}
      </div>
    </div>
  );
}

export interface AboutDialogProps {
  open: boolean;
  onRequestClose: () => void;
}

export function AboutDialog({ open, onRequestClose }: AboutDialogProps) {
  const [section, setSection] = useState<AboutSection>("coverage");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const sectionLabel = ABOUT_SECTIONS.find((item) => item.id === section)?.label ?? "Coverage";

  // The cards are uncontrolled <details>; bulk expand/collapse writes the
  // native open flag directly so per-card toggling keeps working afterwards.
  const setAllCards = (open: boolean) => {
    contentRef.current
      ?.querySelectorAll<HTMLDetailsElement>("details")
      .forEach((card) => { card.open = open; });
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      priorFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleClose = () => {
    onRequestClose();
    priorFocusRef.current?.focus();
  };

  return (
    <dialog
      ref={dialogRef}
      className="about-dialog"
      aria-labelledby="about-title"
      aria-describedby="about-summary"
      onCancel={(event) => {
        event.preventDefault();
        dialogRef.current?.close();
      }}
      onClose={handleClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="about-dialog-frame">
        <header className="about-dialog-header">
          <div>
            <h2 id="about-title">About Sky to Porch</h2>
            {/*
              ADR-0051: this dialog held only the source catalogue, so the
              button labelled "About" answered "which datasets" and never
              "what is this". The product statement lives here now, and the
              eyebrow moved down to label the catalogue it actually describes.
            */}
            <p id="about-summary">
              Sky to Porch turns official satellite and ground observations into a plain
              answer for one place, one day, and one thing you care about.
            </p>
          </div>
          <button type="button" className="about-close" onClick={() => dialogRef.current?.close()} autoFocus>
            Close
          </button>
        </header>

        {/*
          ADR-0051: one scroll region for everything under the title bar. When
          the intro, the tabs, and the catalogue each held a fixed row, the
          catalogue was left scrolling inside a short band. Now the intro
          scrolls away and the catalogue gets the dialog's full height, while
          the tabs stay reachable by sticking to the top of the scroller.
        */}
        <div className="about-dialog-body" ref={contentRef}>
        <div className="about-intro" data-testid="about-intro">
          <p>
            Every answer names the datasets behind it, the exact times they were observed,
            and what they cannot show. A missing observation is reported as missing, never
            as safety.
          </p>
          <p>
            It does not predict, does not describe conditions inside a specific building,
            and does not replace official alerts or local guidance.
          </p>
          {/*
            ADR-0053: the app displayed NASA and NOAA imagery throughout and
            never said it is not theirs. This is a substantive claim about
            what the product is, so it stays in the product statement at body
            size. It is not fine print, and this product does not put its
            boundaries in fine print anywhere else.
          */}
          <p>
            Sky to Porch is an independent project. It is not affiliated with, endorsed
            by, or operated by NASA, NOAA, USGS, or any other agency whose public data
            it displays.
          </p>
          {/*
            Credit and licence, by contrast, are conventional annotation: the
            colophon takes the aside treatment at 12px. The repository is
            private until the owner opens it, so its link is live only from
            that point on.
          */}
          <div className="about-colophon">
            {/*
              The byline is the portfolio link. A separate "see my portfolio"
              call to action would read as a pitch inside a page about
              evidence; a name that leads to the work behind it is the
              convention, and naming the craft gives a reason to follow it.
            */}
            <p>
              Designed and built by{" "}
              <a
                href="https://www.huiyingchung.com/"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="about-author-link"
              >
                Huiying Chung ↗
              </a>
              , a UX designer.
            </p>
            <p>
              © 2026 Huiying Chung. Personal and educational use only.{" "}
              <a
                href="https://github.com/HuiYingChung/sky-to-porch"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="about-source-link"
              >
                Source code on GitHub ↗
              </a>
            </p>
          </div>
          <p className="about-eyebrow">Evidence coverage</p>
        </div>

        <div className="about-section-picker" role="group" aria-label="About sections">
          {ABOUT_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={section === item.id}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
          <div className="about-bulk-controls" role="group" aria-label="Card visibility">
            <button type="button" data-testid="about-expand-all" onClick={() => setAllCards(true)}>
              Expand all
            </button>
            <button type="button" data-testid="about-collapse-all" onClick={() => setAllCards(false)}>
              Collapse all
            </button>
          </div>
        </div>

        <section className="about-dialog-content" aria-label={sectionLabel}>
          {section === "coverage" ? <CoverageSection /> : null}
          {section === "satellite" ? <SatelliteSection /> : null}
          {section === "north-america" ? <NorthAmericaSection /> : null}
        </section>
        </div>
      </div>
    </dialog>
  );
}
