"use client";
/**
 * src/components/query/demo-gallery.tsx
 *
 * ADR-0044: the curated demo-story gallery. Visually separate from the
 * custom-query form but feeding the exact same selection flow: choosing a
 * story (or one of its hazard lenses) pre-fills place, radius, hazard, live
 * mode, and dates, leaving only the user's concern and optional question.
 *
 * Dev-only test scenarios (no-observation box, governed source failure) are
 * rendered as plain place shortcuts and never appear outside dev mode.
 */

import React from "react";
import { HAZARD_LABELS } from "@/data/source-coverage";
import {
  DEMO_STORIES,
  type DemoStory,
  type DemoStoryHazard,
} from "@/data/places/demo-stories";
import type { DemoPlace } from "@/data/places/wp04-demo-places";

export interface DemoGalleryProps {
  /** Test-id prefix, e.g. "desktop-gq-"; cards use `${prefix}place-${id}`. */
  testIdPrefix: string;
  /** Registered demo-place id of the current selection (highlights its card). */
  activePlaceId?: string;
  /** Dev-only plain place shortcuts (test scenarios). */
  devPlaces?: readonly DemoPlace[];
  onSelectStory: (story: DemoStory, hazard: DemoStoryHazard) => void;
  onSelectPlaceOnly: (place: DemoPlace) => void;
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: "4px 10px",
  fontSize: "14px",
  border: "1px solid var(--border-default)",
  borderRadius: "999px",
  background: active ? "var(--surface-3)" : "var(--surface-2)",
  color: "var(--text-primary)",
  cursor: "pointer",
});

/**
 * ADR-0047: hazard chips reuse the per-hazard tokens (contrast-checked in
 * both themes). The hazard name stays in the chip text, so color is never
 * the only signal (color-vision safety).
 */
const hazardChipStyle = (hazardId: string, active: boolean): React.CSSProperties => {
  const token = hazardId.replace(/_/g, "-");
  return {
    padding: "4px 10px",
    fontSize: "14px",
    border: `1px solid var(--hazard-${token}-border)`,
    borderRadius: "999px",
    background: `var(--hazard-${token}-bg)`,
    color: `var(--hazard-${token}-fg)`,
    cursor: "pointer",
    fontWeight: active ? 650 : 400,
    boxShadow: active ? `0 0 0 1px var(--hazard-${token}-border)` : undefined,
  };
};

export function DemoGallery({
  testIdPrefix,
  activePlaceId,
  devPlaces = [],
  onSelectStory,
  onSelectPlaceOnly,
}: DemoGalleryProps) {
  return (
    <section
      aria-label="Example events"
      data-testid={`${testIdPrefix}demo-gallery`}
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "8px",
        padding: "12px",
        background: "var(--surface-1)",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div>
        <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
          Start from a real event
        </p>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "2px 0 0" }}>
          One tap sets the place, hazard, and dates — you only choose what matters to you.
        </p>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {DEMO_STORIES.map((story) => {
          const active = activePlaceId === story.placeId;
          return (
            <li
              key={story.placeId}
              data-testid={`${testIdPrefix}story-${story.placeId}`}
              style={{
                border: `1px solid ${active ? "var(--border-default)" : "var(--border-subtle)"}`,
                borderRadius: "6px",
                padding: "10px 12px",
                background: active ? "var(--surface-2)" : "transparent",
              }}
            >
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                {story.name}
              </p>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: "3px 0 8px" }}>
                {story.story}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {story.hazards.map((hazard, index) => (
                  <button
                    key={hazard.hazardId}
                    type="button"
                    onClick={() => onSelectStory(story, hazard)}
                    data-testid={
                      index === 0
                        ? `${testIdPrefix}place-${story.placeId}`
                        : `${testIdPrefix}place-${story.placeId}-${hazard.hazardId}`
                    }
                    style={hazardChipStyle(hazard.hazardId, active)}
                  >
                    {HAZARD_LABELS[hazard.hazardId]}
                    <span style={{ marginLeft: "6px", fontWeight: 400 }}>
                      {hazard.timeLabel}
                    </span>
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {devPlaces.length > 0 && (
        <div>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "0 0 4px" }}>
            Dev test scenarios
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {devPlaces.map((place) => (
              <button
                key={place.id}
                type="button"
                onClick={() => onSelectPlaceOnly(place)}
                data-testid={`${testIdPrefix}place-${place.id}`}
                style={chipStyle(activePlaceId === place.id)}
              >
                {place.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
