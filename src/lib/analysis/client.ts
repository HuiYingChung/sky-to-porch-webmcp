import { normalizeOptionalQuestion } from "@/lib/ai/optional-question";
import {
  CUSTOM_AREA_PLACE_ID,
  canonicalAreaQueryForSelection,
} from "@/lib/location/query-area";
import type { PlaceSelection } from "@/lib/location/selection";
import {
  DROUGHT_PINNED_FIXTURE_DATE,
  type DroughtQueryResult,
} from "@/lib/drought/types";
import {
  PINNED_FIXTURE_DATE,
  type FireLiveTimeSelection,
  type FireQueryResult,
} from "@/lib/fire/types";
import {
  FLOOD_MAX_RANGE_DAYS,
  FLOOD_PINNED_FIXTURE_DATE,
  FLOOD_UNSUPPORTED_FIXTURE_DATE,
  type FloodQueryResult,
} from "@/lib/flood/types";
import {
  HEAT_PINNED_FIXTURE_DATE,
  HEAT_UNSUPPORTED_FIXTURE_DATE,
  type HeatQueryResult,
} from "@/lib/heat/types";
import type { CoverageGapQueryResult } from "@/lib/coverage-gap/types";
import type { StormQueryResult } from "@/lib/storm/types";
import type {
  AnalysisExecutionOptions,
  AnalysisOutcome,
  AnalysisRequest,
} from "./types";

function registeredPlaceId(selection: PlaceSelection): string {
  if (
    selection.isMapSelection ||
    selection.selectionMethod === "place_search"
  ) {
    return CUSTOM_AREA_PLACE_ID;
  }
  return selection.demoPlaceId ?? "__unknown__";
}

function singleFixtureDate(selection: PlaceSelection): string | null {
  const range = selection.timeSelection;
  if (range.type !== "custom" || !range.startTs || !range.endTs) return null;
  const start = new Date(range.startTs);
  const end = new Date(range.endTs);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  return startDate === PINNED_FIXTURE_DATE && endDate === PINNED_FIXTURE_DATE
    ? PINNED_FIXTURE_DATE
    : null;
}

function liveFireTime(selection: PlaceSelection): FireLiveTimeSelection | null {
  const range = selection.timeSelection;
  if (range.type === "latest") return { kind: "latest", days: 1 };
  if (range.type === "past_7d") return { kind: "latest", days: 7 };
  if (range.type !== "custom" || !range.startTs || !range.endTs) return null;
  const start = new Date(range.startTs);
  const end = new Date(range.endTs);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return {
    kind: "range",
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function completedDates(
  selection: PlaceSelection
): { startDate: string; endDate: string } | null {
  const range = selection.timeSelection;
  if (range.type !== "custom" || !range.startTs || !range.endTs) return null;
  const start = new Date(range.startTs);
  const end = new Date(range.endTs);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function failureReason(
  response: Response,
  payload: { error?: string; retryAfterSeconds?: number },
  hazardLabel: string
): string {
  if (response.status === 429 || payload.error === "rate_limited") {
    const retry = payload.retryAfterSeconds
      ? ` Try again in about ${payload.retryAfterSeconds} seconds.`
      : "";
    return `Too many requests in a short time. No paid AI call or data request was made.${retry}`;
  }
  if (response.status === 403 || payload.error === "origin_rejected") {
    return "This request came from an unexpected origin and was blocked. No paid AI call was made.";
  }
  return `The request couldn't be validated, so no ${hazardLabel} evidence was returned.`;
}

function throwIfAborted(error: unknown): void {
  if (
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    throw error;
  }
}

async function postJson(
  path: string,
  body: unknown,
  options: AnalysisExecutionOptions
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return { response, payload };
}

async function analyzeCoverageGap(
  request: AnalysisRequest,
  optionalQuestion: string | undefined,
  options: AnalysisExecutionOptions
): Promise<AnalysisOutcome> {
  const { hazardId, concern, placeSelection } = request;
  if (hazardId !== "air_quality" && hazardId !== "earth_volcanoes") {
    throw new Error("coverage-gap hazard mismatch");
  }
  const dates = completedDates(placeSelection);
  const date = dates && dates.startDate === dates.endDate
    ? dates.startDate
    : null;
  if (date === null) {
    const result: CoverageGapQueryResult = {
      kind: "unsupported_date",
      hazardId,
      date: "unresolved",
      area: placeSelection.analysisArea.boundingBox,
      retrievalAttempted: false,
      sourceOutcomes: hazardId === "air_quality"
        ? {
            nasa_gibs_modis_aod: "not_attempted",
            airnow_daily_data: "not_attempted",
          }
        : {
            nasa_gibs_omps_so2: "not_attempted",
            usgs_volcano_hans: "not_attempted",
            usgs_earthquake_geojson: "not_attempted",
            earthquake_prediction: "out_of_scope",
          },
      meaning: {
        concern,
        summary:
          "Choose one completed UTC date first; coverage can only be checked for a finished day.",
        optionalQuestionAcknowledged: optionalQuestion !== undefined,
      },
      limitations: [
        "No observation was queried, and missing evidence is not evidence of no danger.",
      ],
      rejectionReason: "Choose exactly one completed UTC date.",
    };
    return { hazardId, result };
  }

  try {
    const { payload } = await postJson(
      hazardId === "air_quality" ? "/api/air/query" : "/api/volcano/query",
      {
        ...canonicalAreaQueryForSelection(placeSelection),
        date,
        concern,
        ...(optionalQuestion ? { optionalQuestion } : {}),
      },
      options
    );
    if (payload.ok === true && payload.result) {
      return {
        hazardId,
        result: payload.result as CoverageGapQueryResult,
      };
    }
  } catch (error) {
    throwIfAborted(error);
  }

  return {
    hazardId,
    result: {
      kind: "source_failure",
      hazardId,
      date,
      area: placeSelection.analysisArea.boundingBox,
      retrievalAttempted: false,
      sourceOutcomes: {},
      meaning: {
        concern,
        summary:
          "The check failed. No older or unrelated information was substituted.",
        optionalQuestionAcknowledged: optionalQuestion !== undefined,
      },
      limitations: [
        "A request failure is not evidence of safe conditions or no danger.",
      ],
      rejectionReason:
        "The request couldn't be completed, so no data was retrieved.",
    },
  };
}

async function analyzeDrought(
  request: AnalysisRequest,
  optionalQuestion: string | undefined,
  options: AnalysisExecutionOptions
): Promise<AnalysisOutcome> {
  const { placeSelection, concern } = request;
  const mode = request.evidenceMode ?? "live";
  const registered = registeredPlaceId(placeSelection);
  const placeId = mode === "live" ? CUSTOM_AREA_PLACE_ID : registered;
  const dates = completedDates(placeSelection);
  const date = dates && dates.startDate === dates.endDate
    ? dates.startDate
    : null;

  if (mode === "fixture" && placeId === CUSTOM_AREA_PLACE_ID) {
    return {
      hazardId: "drought_land",
      result: {
        kind: "unsupported_place",
        sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
        rejectionReason:
          "Fixture mode uses the labelled Tucson case. Live mode uses the global satellite baseline for a selected area.",
      },
    };
  }
  if (mode === "live" && registered === "demo-source-failure") {
    return {
      hazardId: "drought_land",
      result: {
        kind: "unsupported_place",
        sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
        rejectionReason:
          "The source-failure case is fixture-only; no live Drought request was sent.",
      },
    };
  }
  if (date === null || (mode === "fixture" && date !== DROUGHT_PINNED_FIXTURE_DATE)) {
    return {
      hazardId: "drought_land",
      result: {
        kind: "unsupported_date",
        sourceOutcomes: { gibs: "not_attempted", usdm: "not_attempted" },
        rejectionReason:
          mode === "fixture"
            ? `Drought fixture mode accepts one UTC date: ${DROUGHT_PINNED_FIXTURE_DATE}.`
            : "Drought needs exactly one completed UTC date (up to yesterday).",
      },
    };
  }

  try {
    const { response, payload } = await postJson(
      "/api/drought/query",
      mode === "live"
        ? {
            ...canonicalAreaQueryForSelection(placeSelection),
            date,
            mode,
            concern,
            ...(optionalQuestion ? { optionalQuestion } : {}),
          }
        : {
            placeId,
            date,
            mode,
            concern,
            ...(optionalQuestion ? { optionalQuestion } : {}),
          },
      options
    );
    if (payload.ok === true && payload.result) {
      return {
        hazardId: "drought_land",
        result: payload.result as DroughtQueryResult,
      };
    }
    return {
      hazardId: "drought_land",
      result: {
        kind: "source_failure",
        sourceOutcomes: { gibs: "failed", usdm: "failed" },
        rejectionReason: failureReason(response, payload, "Drought"),
      },
    };
  } catch (error) {
    throwIfAborted(error);
    return {
      hazardId: "drought_land",
      result: {
        kind: "source_failure",
        sourceOutcomes: { gibs: "failed", usdm: "failed" },
        rejectionReason:
          "The drought check failed. No older or unrelated information was substituted.",
      },
    };
  }
}

async function analyzeHeat(
  request: AnalysisRequest,
  optionalQuestion: string | undefined,
  options: AnalysisExecutionOptions
): Promise<AnalysisOutcome> {
  const { placeSelection, concern } = request;
  const mode = request.evidenceMode ?? "live";
  const registered = registeredPlaceId(placeSelection);
  const placeId = mode === "live" ? CUSTOM_AREA_PLACE_ID : registered;
  const dates = completedDates(placeSelection);
  const date = dates && dates.startDate === dates.endDate
    ? dates.startDate
    : null;
  const fixtureDateAllowed =
    date === HEAT_PINNED_FIXTURE_DATE ||
    date === HEAT_UNSUPPORTED_FIXTURE_DATE;

  if (mode === "fixture" && placeId === CUSTOM_AREA_PLACE_ID) {
    return {
      hazardId: "extreme_heat",
      result: {
        kind: "unsupported_place",
        rejectionReason:
          "Fixture mode uses registered demo places. Live mode supports map-selected areas.",
      },
    };
  }
  if (mode === "live" && registered === "demo-source-failure") {
    return {
      hazardId: "extreme_heat",
      result: {
        kind: "unsupported_place",
        rejectionReason:
          "The source-failure case is fixture-only; no live Heat request was sent.",
      },
    };
  }
  if (date === null || (mode === "fixture" && !fixtureDateAllowed)) {
    return {
      hazardId: "extreme_heat",
      result: {
        kind: "unsupported_date",
        rejectionReason:
          mode === "fixture"
            ? `Heat fixture mode accepts one UTC date: ${HEAT_PINNED_FIXTURE_DATE} or the labelled unsupported case ${HEAT_UNSUPPORTED_FIXTURE_DATE}.`
            : "Extreme Heat needs exactly one completed UTC date (up to yesterday).",
      },
    };
  }

  try {
    const { response, payload } = await postJson(
      "/api/heat/query",
      mode === "live"
        ? {
            ...canonicalAreaQueryForSelection(placeSelection),
            date,
            mode,
            concern,
            ...(optionalQuestion ? { optionalQuestion } : {}),
          }
        : {
            placeId,
            date,
            mode,
            concern,
            ...(optionalQuestion ? { optionalQuestion } : {}),
          },
      options
    );
    if (payload.ok === true && payload.result) {
      return {
        hazardId: "extreme_heat",
        result: payload.result as HeatQueryResult,
      };
    }
    return {
      hazardId: "extreme_heat",
      result: {
        kind: "source_failure",
        rejectionReason: failureReason(response, payload, "Extreme Heat"),
      },
    };
  } catch (error) {
    throwIfAborted(error);
    return {
      hazardId: "extreme_heat",
      result: {
        kind: "source_failure",
        rejectionReason:
          "The heat check failed. No older or unrelated information was substituted.",
      },
    };
  }
}

async function analyzeFlood(
  request: AnalysisRequest,
  optionalQuestion: string | undefined,
  options: AnalysisExecutionOptions
): Promise<AnalysisOutcome> {
  const { placeSelection, concern } = request;
  const mode = request.evidenceMode ?? "live";
  const registered = registeredPlaceId(placeSelection);
  const placeId = mode === "live" ? CUSTOM_AREA_PLACE_ID : registered;
  const dates = completedDates(placeSelection);
  const fixtureDate = dates && dates.startDate === dates.endDate
    ? dates.startDate
    : null;
  const fixtureDateAllowed =
    fixtureDate === FLOOD_PINNED_FIXTURE_DATE ||
    fixtureDate === FLOOD_UNSUPPORTED_FIXTURE_DATE;

  if (mode === "fixture" && placeId === CUSTOM_AREA_PLACE_ID) {
    return {
      hazardId: "flood_storm",
      result: {
        kind: "unsupported_place",
        rejectionReason:
          "Fixture mode uses registered demo places. Live mode supports map-selected areas.",
      },
    };
  }
  if (mode === "live" && registered === "demo-source-failure") {
    return {
      hazardId: "flood_storm",
      result: {
        kind: "unsupported_place",
        rejectionReason:
          "The source-failure case is fixture-only; no live request was sent.",
      },
    };
  }

  const liveSpanDays = dates
    ? (Date.parse(`${dates.endDate}T00:00:00Z`) -
        Date.parse(`${dates.startDate}T00:00:00Z`)) /
        86_400_000 +
      1
    : 0;
  if (
    dates === null ||
    (mode === "fixture" && !fixtureDateAllowed) ||
    (mode === "live" && liveSpanDays > FLOOD_MAX_RANGE_DAYS)
  ) {
    return {
      hazardId: "flood_storm",
      result: {
        kind: "unsupported_date",
        rejectionReason:
          mode === "fixture"
            ? `Flood fixture mode accepts only a one-day custom range on ${FLOOD_PINNED_FIXTURE_DATE} or ${FLOOD_UNSUPPORTED_FIXTURE_DATE}.`
            : `Flood needs a date range of 1 to ${FLOOD_MAX_RANGE_DAYS} completed UTC days.`,
      },
    };
  }

  try {
    const { response, payload } = await postJson(
      "/api/flood/query",
      mode === "fixture"
        ? {
            placeId,
            date: fixtureDate,
            mode,
            concern,
            ...(optionalQuestion ? { optionalQuestion } : {}),
          }
        : {
            ...canonicalAreaQueryForSelection(placeSelection),
            startDate: dates.startDate,
            endDate: dates.endDate,
            mode,
            concern,
            ...(optionalQuestion ? { optionalQuestion } : {}),
          },
      options
    );
    if (payload.ok === true && payload.result) {
      return {
        hazardId: "flood_storm",
        result: payload.result as FloodQueryResult,
      };
    }
    return {
      hazardId: "flood_storm",
      result: {
        kind: "source_failure",
        rejectionReason: failureReason(response, payload, "Flood"),
      },
    };
  } catch (error) {
    throwIfAborted(error);
    return {
      hazardId: "flood_storm",
      result: {
        kind: "source_failure",
        rejectionReason:
          "The flood check failed. No older or unrelated information was substituted.",
      },
    };
  }
}

async function analyzeWindStorm(
  request: AnalysisRequest,
  optionalQuestion: string | undefined,
  options: AnalysisExecutionOptions
): Promise<AnalysisOutcome> {
  const { placeSelection, concern } = request;
  const dates = completedDates(placeSelection);
  const date = dates && dates.startDate === dates.endDate
    ? dates.startDate
    : null;
  if (date === null) {
    return {
      hazardId: "wind_storm",
      result: {
        kind: "unsupported_date",
        rejectionReason: "Wind & Storm needs exactly one completed UTC date.",
      },
    };
  }
  try {
    const { response, payload } = await postJson(
      "/api/storm/query",
      {
        ...canonicalAreaQueryForSelection(placeSelection),
        date,
        mode: "live",
        concern,
        ...(optionalQuestion ? { optionalQuestion } : {}),
      },
      options
    );
    if (payload.ok === true && payload.result) {
      return {
        hazardId: "wind_storm",
        result: payload.result as StormQueryResult,
      };
    }
    return {
      hazardId: "wind_storm",
      result: {
        kind: "source_failure",
        rejectionReason: failureReason(response, payload, "Wind & Storm"),
      },
    };
  } catch (error) {
    throwIfAborted(error);
    return {
      hazardId: "wind_storm",
      result: {
        kind: "source_failure",
        rejectionReason:
          "The wind check failed. No rain, flood, example, or out-of-area station information was substituted.",
      },
    };
  }
}

async function analyzeFire(
  request: AnalysisRequest,
  optionalQuestion: string | undefined,
  options: AnalysisExecutionOptions
): Promise<AnalysisOutcome> {
  const { placeSelection, concern } = request;
  const mode = request.evidenceMode ?? "live";
  const registered = registeredPlaceId(placeSelection);
  const placeId = mode === "live" ? CUSTOM_AREA_PLACE_ID : registered;

  if (mode === "fixture" && placeId === CUSTOM_AREA_PLACE_ID) {
    return {
      hazardId: "fire_smoke",
      result: {
        kind: "unsupported_place",
        rejectionReason:
          "Fixture mode uses registered demo places. Live mode supports map-selected areas.",
      },
    };
  }
  if (mode === "live" && registered === "demo-source-failure") {
    return {
      hazardId: "fire_smoke",
      result: {
        kind: "unsupported_place",
        rejectionReason:
          "demo-source-failure is a labelled fixture test case and is not available in live mode.",
      },
    };
  }

  const date = mode === "fixture" ? singleFixtureDate(placeSelection) : null;
  const time = mode === "live" ? liveFireTime(placeSelection) : null;
  if ((mode === "fixture" && date === null) || (mode === "live" && time === null)) {
    return {
      hazardId: "fire_smoke",
      result: {
        kind: "unsupported_date",
        rejectionReason:
          mode === "fixture"
            ? `Fixture mode accepts only a custom range whose start and end are ${PINNED_FIXTURE_DATE}.`
            : "Fire supports Latest completed day, Past 7 days, or a range of 1 to 7 completed UTC days.",
      },
    };
  }

  try {
    const { response, payload } = await postJson(
      "/api/fire/query",
      mode === "fixture"
        ? {
            placeId,
            date,
            mode,
            concern,
            ...(optionalQuestion ? { optionalQuestion } : {}),
          }
        : {
            ...canonicalAreaQueryForSelection(placeSelection),
            time,
            mode,
            concern,
            ...(optionalQuestion ? { optionalQuestion } : {}),
          },
      options
    );
    if (payload.ok === true && payload.result) {
      return {
        hazardId: "fire_smoke",
        result: payload.result as FireQueryResult,
      };
    }
    return {
      hazardId: "fire_smoke",
      result: {
        kind: "source_failure",
        rejectionReason: failureReason(response, payload, "Fire & Smoke"),
      },
    };
  } catch (error) {
    throwIfAborted(error);
    return {
      hazardId: "fire_smoke",
      result: {
        kind: "source_failure",
        rejectionReason: "Request failed. No evidence returned.",
      },
    };
  }
}

export async function executeAnalysisRequest(
  request: AnalysisRequest,
  options: AnalysisExecutionOptions = {}
): Promise<AnalysisOutcome> {
  const optionalQuestion = normalizeOptionalQuestion(request.optionalQuestion);
  switch (request.hazardId) {
    case "air_quality":
    case "earth_volcanoes":
      return analyzeCoverageGap(request, optionalQuestion, options);
    case "drought_land":
      return analyzeDrought(request, optionalQuestion, options);
    case "extreme_heat":
      return analyzeHeat(request, optionalQuestion, options);
    case "flood_storm":
      return analyzeFlood(request, optionalQuestion, options);
    case "wind_storm":
      return analyzeWindStorm(request, optionalQuestion, options);
    case "fire_smoke":
      return analyzeFire(request, optionalQuestion, options);
  }
}
