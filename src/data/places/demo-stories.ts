/**
 * src/data/places/demo-stories.ts
 *
 * ADR-0044: curated demo stories. Each story is a real, recognizable event
 * or condition tied to one registered demo place, and pre-fills everything a
 * query needs except the user's concern and optional question: place,
 * analysis radius, hazard, live mode, and a per-hazard date range.
 *
 * A story may carry up to two hazards (for example the January 2025 Los
 * Angeles fires as Fire & Smoke or as Air Quality); the user picks which
 * lens to open, and each lens carries its own dates. Dates are either fixed
 * historical dates verified against the live sources, or "latest completed
 * UTC day" for weekly/rolling products such as the U.S. Drought Monitor.
 */

import type { HazardId } from "@/contracts/common";
import { getDemoPlaceById, type DemoPlace } from "@/data/places/wp04-demo-places";
import { latestCompletedUtcDate } from "@/lib/ui/date-input";

export type DemoStoryDatePreset =
  | { kind: "fixed"; startDate: string; endDate: string }
  | { kind: "latest_completed" };

export interface DemoStoryHazard {
  hazardId: HazardId;
  /** Short user-facing time label shown on the chip, e.g. "Jan 8–10, 2025". */
  timeLabel: string;
  preset: DemoStoryDatePreset;
}

export interface DemoStory {
  /** Registered DemoPlace id this story selects. */
  placeId: string;
  /** User-facing place name, e.g. "Houston, TX". */
  name: string;
  /** One line saying why this place and time are worth looking at. */
  story: string;
  /** Analysis radius applied on selection. */
  radiusKm: number;
  /** 1–2 hazard lenses; the first is the card's primary action. */
  hazards: readonly DemoStoryHazard[];
}

export const DEMO_STORIES: readonly DemoStory[] = [
  {
    placeId: "demo-los-angeles",
    name: "Los Angeles, CA",
    story: "The January 2025 wildfires — fire detections, smoke, and the air people breathed.",
    radiusKm: 60,
    hazards: [
      {
        hazardId: "fire_smoke",
        timeLabel: "Jan 8–10, 2025",
        preset: { kind: "fixed", startDate: "2025-01-08", endDate: "2025-01-10" },
      },
      {
        hazardId: "air_quality",
        timeLabel: "Jan 9, 2025",
        preset: { kind: "fixed", startDate: "2025-01-09", endDate: "2025-01-09" },
      },
    ],
  },
  {
    placeId: "demo-houston",
    name: "Houston, TX",
    story: "Hurricane Beryl (July 2024) — wind, rain, flooding, and evidence for real-world decisions.",
    radiusKm: 50,
    hazards: [
      {
        hazardId: "wind_storm",
        timeLabel: "Jul 8, 2024",
        preset: { kind: "fixed", startDate: "2024-07-08", endDate: "2024-07-08" },
      },
      {
        hazardId: "flood_storm",
        timeLabel: "Jul 8–9, 2024",
        preset: { kind: "fixed", startDate: "2024-07-08", endDate: "2024-07-09" },
      },
    ],
  },
  {
    placeId: "demo-tucson",
    name: "Tucson, AZ",
    story: "Desert summer heat at a NOAA reference station, and the region's drought status.",
    radiusKm: 25,
    hazards: [
      {
        hazardId: "extreme_heat",
        timeLabel: "Jul 10, 2025",
        preset: { kind: "fixed", startDate: "2025-07-10", endDate: "2025-07-10" },
      },
      {
        hazardId: "drought_land",
        timeLabel: "Latest week",
        preset: { kind: "latest_completed" },
      },
    ],
  },
  {
    placeId: "demo-las-vegas",
    name: "Las Vegas, NV",
    story: "The long Southwest drought around Lake Mead — official weekly status with satellite context.",
    radiusKm: 50,
    hazards: [
      {
        hazardId: "drought_land",
        timeLabel: "Latest week",
        preset: { kind: "latest_completed" },
      },
    ],
  },
  {
    placeId: "demo-hawaii-island",
    name: "Hawaii Island, HI",
    story: "Kīlauea's June 2024 activity — observed earthquakes and official volcano notices.",
    radiusKm: 80,
    hazards: [
      {
        hazardId: "earth_volcanoes",
        timeLabel: "Jun 3, 2024",
        preset: { kind: "fixed", startDate: "2024-06-03", endDate: "2024-06-03" },
      },
    ],
  },
  {
    placeId: "demo-new-york",
    name: "New York City, NY",
    story: "The June 2023 wildfire-smoke episode — a record air-quality day in official readings.",
    radiusKm: 40,
    hazards: [
      {
        hazardId: "air_quality",
        timeLabel: "Jun 7, 2023",
        preset: { kind: "fixed", startDate: "2023-06-07", endDate: "2023-06-07" },
      },
    ],
  },
] as const;

/** Resolve a story hazard's preset into concrete YYYY-MM-DD dates. */
export function resolveDemoStoryDates(
  preset: DemoStoryDatePreset,
  now: Date = new Date()
): { startDate: string; endDate: string } {
  if (preset.kind === "fixed") {
    return { startDate: preset.startDate, endDate: preset.endDate };
  }
  const latest = latestCompletedUtcDate(now);
  return { startDate: latest, endDate: latest };
}

/** The registered DemoPlace a story selects. Throws if the id drifted. */
export function demoStoryPlace(story: DemoStory): DemoPlace {
  const place = getDemoPlaceById(story.placeId);
  if (!place) throw new Error(`demo story references unknown place: ${story.placeId}`);
  return place;
}
