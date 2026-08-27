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

import type { ConcernType, HazardId } from "@/contracts/common";
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

export interface WebMcpDemoScenario {
  id: "houston-beryl-roof" | "los-angeles-smoke-health" | "tucson-heat-pets";
  title: string;
  prompt: string;
  analysisInput: {
    place: string;
    hazard: HazardId;
    concern: ConcernType;
    radius_km: number;
    start_date: string;
    end_date: string;
  };
}

/**
 * Curated historical Agent journeys. The concerns make the demonstration
 * concrete, but concern remains optional in the WebMCP analysis contract.
 */
export const WEBMCP_DEMO_SCENARIOS: readonly WebMcpDemoScenario[] = [
  {
    id: "houston-beryl-roof",
    title: "Houston roof concern after Hurricane Beryl",
    prompt:
      "After Hurricane Beryl, I noticed missing shingles and a new roof leak at my Houston home. How strongly do official wind and related flood or heavy-rain records support the concern that the storm contributed to the roof damage on July 8, 2024? Lead with the strongest observations, cite their times and official sources, distinguish direct observations from inference, and give the strongest evidence-supported assessment with a confidence level. Explain what property-specific evidence would most strengthen or weaken that assessment for an insurer discussion.",
    analysisInput: {
      place: "Houston, Texas",
      hazard: "wind_storm",
      concern: "home",
      radius_km: 25,
      start_date: "2024-07-08",
      end_date: "2024-07-08",
    },
  },
  {
    id: "los-angeles-smoke-health",
    title: "Los Angeles symptoms during the January 2025 fires",
    prompt:
      "On January 9, 2025, my family experienced coughing and eye irritation in Los Angeles. How strongly do official fire-and-smoke observations and related air-quality records support smoke or poor outdoor air as a plausible contributor? Lead with the strongest findings, cite their times and official sources, distinguish direct observations from inference, and give the strongest evidence-supported assessment with a confidence level. Explain what personal, indoor, or clinical evidence would most strengthen or weaken that assessment.",
    analysisInput: {
      place: "Los Angeles, California",
      hazard: "fire_smoke",
      concern: "health",
      radius_km: 60,
      start_date: "2025-01-09",
      end_date: "2025-01-09",
    },
  },
  {
    id: "tucson-heat-pets",
    title: "Tucson dog concern after outdoor heat",
    prompt:
      "After spending time outdoors in Tucson on July 10, 2025, my dog was unusually lethargic. How strongly do official extreme-heat observations and related drought records support heat exposure as a plausible contributor? Lead with the strongest readings, cite their observation or reporting dates and official sources, distinguish direct observations from inference, and give the strongest evidence-supported assessment with a confidence level. Explain whether the drought record materially reinforces the heat concern and what pet-specific evidence would strengthen or weaken the assessment.",
    analysisInput: {
      place: "Tucson, Arizona",
      hazard: "extreme_heat",
      concern: "pets",
      radius_km: 25,
      start_date: "2025-07-10",
      end_date: "2025-07-10",
    },
  },
] as const;

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
