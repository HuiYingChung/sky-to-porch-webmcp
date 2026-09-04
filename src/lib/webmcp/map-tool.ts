/// <reference types="webmcp-types" />

import {
  buildGeocodedPlaceSelection,
  updateSelectionParams,
  type PlaceSelection,
} from "@/lib/location/selection";
import {
  ENVIRONMENTAL_MAP_LAYER_IDS,
  ENVIRONMENTAL_MAP_LIMITATIONS,
  ENVIRONMENTAL_MAP_SOURCES,
  isStrictUtcMapDate,
  latestCompletedUtcDate,
  sameMapSelection,
  singleMapDateFromSelection,
  type EnvironmentalMapLayerId,
  type EnvironmentalMapLayerPatch,
  type EnvironmentalMapState,
} from "@/lib/map/environmental-map-state";
import {
  PLACE_CHOICE_ID_PATTERN_SOURCE,
  PLACE_CHOICE_ID_RE,
  resolveNamedPlace,
  validPlaceQuery,
  type AgentPlaceChoice,
} from "@/lib/webmcp/place-resolution";

export const SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME =
  "set_environmental_map_layers";

const LAYER_PROPERTIES = Object.fromEntries(
  ENVIRONMENTAL_MAP_LAYER_IDS.map((layerId) => [
    layerId,
    {
      type: "boolean",
      description:
        `Desired visibility for ${layerId}. Omit this field to leave that layer unchanged.`,
    },
  ])
);

export const SET_ENVIRONMENTAL_MAP_LAYERS_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["layers"],
  properties: {
    layers: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: LAYER_PROPERTIES,
      description:
        "Desired-state patch. Omitted layers stay unchanged; true shows and false hides. Repeating the same patch is idempotent.",
    },
    place: {
      type: ["string", "null"],
      minLength: 2,
      maxLength: 200,
      description:
        "Optional place to select and frame before updating layers. Omit to keep the current map place.",
    },
    place_choice_id: {
      type: ["string", "null"],
      pattern: PLACE_CHOICE_ID_PATTERN_SOURCE,
      description:
        "After an ambiguous place result, copy the person-selected choice_id exactly while preserving the original place and other arguments.",
    },
    date: {
      type: ["string", "null"],
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description:
        "Optional single UTC calendar date. Multi-day ranges are never silently collapsed to one map date.",
    },
    radius_km: {
      type: ["number", "null"],
      minimum: 1,
      maximum: 250,
      description:
        "Optional analysis-area radius in kilometres. Omit to preserve the current radius, or use 25 km for a new place.",
    },
  },
} as const;

export interface EnvironmentalMapToolSnapshot {
  placeSelection: PlaceSelection | null;
  mapState: EnvironmentalMapState;
}

export interface EnvironmentalMapToolUpdate {
  selection: PlaceSelection | null;
  date: string | null;
  layers: EnvironmentalMapLayerPatch;
  origin: "agent";
}

export interface EnvironmentalMapToolUpdateResult {
  mapState: EnvironmentalMapState;
  analysisCleared: boolean;
}

export interface SetEnvironmentalMapLayersDependencies {
  readState: () => EnvironmentalMapToolSnapshot;
  applyUpdate: (
    update: EnvironmentalMapToolUpdate
  ) => EnvironmentalMapToolUpdateResult;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Reserve invocation order before any asynchronous place lookup. */
  beginInvocation?: () => () => boolean;
  /** Shared with analysis tools because a named-place map call changes place. */
  beginContextInvocation?: () => () => boolean;
}

interface LayerOutput {
  requested: boolean;
  visible: boolean;
  status: EnvironmentalMapState["layers"][EnvironmentalMapLayerId]["status"];
  date: string | null;
  visualization_only: true;
  source: string;
  limitation: string;
  status_detail: string;
}

interface EnvironmentalMapRetryArguments {
  layers: EnvironmentalMapLayerPatch;
  place: string;
  date?: string | null;
  radius_km?: number | null;
}

export type SetEnvironmentalMapLayersOutput =
  | {
      status: "success";
      ui_updated: true;
      analysis_cleared: boolean;
      selected_place: null | {
        label: string;
        longitude: number;
        latitude: number;
        radius_km: number;
        bounding_box: PlaceSelection["placeBoundingBox"] | null;
      };
      map_date: string | null;
      map_state_revision: number;
      layers: Record<EnvironmentalMapLayerId, LayerOutput>;
      boundary: string;
    }
  | {
      status:
        | "invalid_input"
        | "place_not_found"
        | "place_lookup_failed"
        | "needs_place_choice"
        | "superseded";
      message: string;
      ui_updated: false;
      reason?: "rate_limited";
      choices?: AgentPlaceChoice[];
      requires_user_input?: true;
      required_next_action?: "ask_user_to_choose_place_and_wait";
      must_not_select_place?: true;
      must_not_retry_before_user_reply?: true;
      after_user_choice?: {
        required_next_action: "retry_map_update_with_selected_place";
        continue_task: true;
        preserve_original_arguments: true;
        set_place_choice_id_to_selected_choice_id: true;
        retry_with_original_arguments: EnvironmentalMapRetryArguments;
      };
    };

function invalidInput(message: string): SetEnvironmentalMapLayersOutput {
  return { status: "invalid_input", message, ui_updated: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLayerPatch(value: unknown): EnvironmentalMapLayerPatch | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0) return null;
  if (keys.some((key) =>
    !(ENVIRONMENTAL_MAP_LAYER_IDS as readonly string[]).includes(key) ||
    typeof value[key] !== "boolean"
  )) return null;
  return value as EnvironmentalMapLayerPatch;
}

function choiceOutput(
  place: string,
  choices: AgentPlaceChoice[],
  refreshed: boolean,
  retryArguments: EnvironmentalMapRetryArguments
): SetEnvironmentalMapLayersOutput {
  return {
    status: "needs_place_choice",
    message: `PAUSE FOR USER: ${refreshed
      ? "The previous place choice is stale; refreshed search results contain"
      : "Place search found"} ${choices.length} possible place${choices.length === 1 ? "" : "s"} for “${place}”. Ask the person to choose one, wait for a new message, then retry with every original argument unchanged and set only place_choice_id.`,
    ui_updated: false,
    choices,
    requires_user_input: true,
    required_next_action: "ask_user_to_choose_place_and_wait",
    must_not_select_place: true,
    must_not_retry_before_user_reply: true,
    after_user_choice: {
      required_next_action: "retry_map_update_with_selected_place",
      continue_task: true,
      preserve_original_arguments: true,
      set_place_choice_id_to_selected_choice_id: true,
      retry_with_original_arguments: retryArguments,
    },
  };
}

function effectiveVisibility(
  layer: EnvironmentalMapState["layers"][EnvironmentalMapLayerId]
): boolean {
  return layer.visible && layer.status === "ready";
}

function noImageryStatusDetail(layerId: EnvironmentalMapLayerId): string {
  if (layerId === "rain_satellite" || layerId === "surface_heat_satellite") {
    return "The NASA GIBS check found no visible pixels. It cannot distinguish a valid fully transparent image from unavailable coverage, and this is not evidence of no hazard.";
  }
  if (layerId === "thermal_anomalies_firms") {
    return "The NASA FIRMS query completed with zero qualifying thermal-anomaly detections for this area and date. Zero detections is not evidence of no fire or safety.";
  }
  return "The flood-extent retrieval returned no rendered observation for this area and date. A transparent response or no observation is not evidence of no flooding, depth, impact, or safety.";
}

function outputLayers(
  state: EnvironmentalMapState
): Record<EnvironmentalMapLayerId, LayerOutput> {
  return Object.fromEntries(ENVIRONMENTAL_MAP_LAYER_IDS.map((layerId) => {
    const layer = state.layers[layerId];
    return [layerId, {
      requested: layer.visible,
      visible: effectiveVisibility(layer),
      status: layer.status,
      date: state.date,
      visualization_only: true as const,
      source: ENVIRONMENTAL_MAP_SOURCES[layerId],
      limitation: ENVIRONMENTAL_MAP_LIMITATIONS[layerId],
      status_detail: layer.status === "no_imagery"
        ? noImageryStatusDetail(layerId)
        : layer.status === "source_failure"
          ? "The source or renderer failed; this says nothing about actual hazard conditions."
          : layer.status === "unsupported_date"
            ? "This visualization source does not support the selected UTC date."
            : layer.status === "loading"
              ? "The requested visualization has not yet reached a verified rendered state."
              : layer.status === "ready"
                ? "The visualization source reported ready; it remains contextual imagery, not a hazard determination."
                : "The layer is not requested for display.",
    }];
  })) as Record<EnvironmentalMapLayerId, LayerOutput>;
}

export async function executeSetEnvironmentalMapLayersTool(
  rawInput: Record<string, unknown>,
  options: WebMCP.ToolExecuteCallbackOptions | undefined,
  dependencies: SetEnvironmentalMapLayersDependencies
): Promise<SetEnvironmentalMapLayersOutput> {
  const allowedKeys = new Set([
    "layers",
    "place",
    "place_choice_id",
    "date",
    "radius_km",
  ]);
  if (Object.keys(rawInput).some((key) => !allowedKeys.has(key))) {
    return invalidInput(
      "Only layers, place, place_choice_id, date, and radius_km are accepted."
    );
  }
  const layerPatch = parseLayerPatch(rawInput.layers);
  if (!layerPatch) {
    return invalidInput(
      "layers must contain at least one supported layer set explicitly to true or false."
    );
  }
  if (
    rawInput.place !== undefined &&
    rawInput.place !== null &&
    !validPlaceQuery(rawInput.place)
  ) {
    return invalidInput("place must be 2–200 characters with no control characters.");
  }
  if (
    rawInput.place_choice_id !== undefined &&
    rawInput.place_choice_id !== null &&
    (typeof rawInput.place_choice_id !== "string" ||
      !PLACE_CHOICE_ID_RE.test(rawInput.place_choice_id))
  ) {
    return invalidInput(
      "place_choice_id must be copied unchanged from a prior ambiguous result."
    );
  }
  if (
    typeof rawInput.place_choice_id === "string" &&
    typeof rawInput.place !== "string"
  ) {
    return invalidInput("place_choice_id requires the original place argument.");
  }
  if (
    rawInput.radius_km !== undefined &&
    rawInput.radius_km !== null &&
    (typeof rawInput.radius_km !== "number" ||
      !Number.isFinite(rawInput.radius_km) ||
      rawInput.radius_km < 1 ||
      rawInput.radius_km > 250)
  ) {
    return invalidInput("radius_km must be a finite number from 1 to 250.");
  }

  const now = dependencies.now?.() ?? new Date();
  if (
    rawInput.date !== undefined &&
    rawInput.date !== null &&
    (typeof rawInput.date !== "string" ||
      !isStrictUtcMapDate(rawInput.date) ||
      rawInput.date > now.toISOString().slice(0, 10))
  ) {
    return invalidInput("date must be a real, non-future UTC date in YYYY-MM-DD format.");
  }

  const signal = options?.signal ?? new AbortController().signal;
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
  const isCurrentInvocation = dependencies.beginInvocation?.() ?? (() => true);
  const isCurrentContext = typeof rawInput.place === "string"
    ? dependencies.beginContextInvocation?.() ?? (() => true)
    : () => true;

  const current = dependencies.readState();
  let selection = current.placeSelection;
  let resolvedNewPlace = false;
  if (typeof rawInput.place === "string") {
    const place = rawInput.place.trim();
    const retryArguments: EnvironmentalMapRetryArguments = {
      layers: { ...layerPatch },
      place,
      ...(rawInput.date !== undefined
        ? { date: rawInput.date as string | null }
        : {}),
      ...(rawInput.radius_km !== undefined
        ? { radius_km: rawInput.radius_km as number | null }
        : {}),
    };
    const resolution = await resolveNamedPlace(
      place,
      typeof rawInput.place_choice_id === "string"
        ? rawInput.place_choice_id
        : undefined,
      dependencies.fetchImpl ?? fetch,
      signal
    );
    if (signal.aborted) {
      throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
    }
    if (!isCurrentInvocation() || !isCurrentContext()) {
      return {
        status: "superseded",
        message:
          "A newer map request replaced this request while place lookup was running, so its result was not applied.",
        ui_updated: false,
      };
    }
    const latest = dependencies.readState();
    if (
      latest.mapState.revision !== current.mapState.revision ||
      latest.mapState.agentFocusRevision !== current.mapState.agentFocusRevision ||
      !sameMapSelection(latest.placeSelection, current.placeSelection)
    ) {
      return {
        status: "superseded",
        message:
          "The selected map context changed while place lookup was running, so the stale result was not applied. Retry only if the requested map update is still wanted.",
        ui_updated: false,
      };
    }
    if (resolution.status === "place_not_found") {
      return {
        status: "place_not_found",
        message: `No place candidate was found for “${place}”.`,
        ui_updated: false,
      };
    }
    if (resolution.status === "place_lookup_failed") {
      return {
        status: "place_lookup_failed",
        message: resolution.reason === "rate_limited"
          ? "Place search was rate-limited; wait briefly before retrying."
          : "Place search was unavailable; the map was not changed.",
        ui_updated: false,
        ...(resolution.reason ? { reason: resolution.reason } : {}),
      };
    }
    if (resolution.status === "needs_place_choice") {
      return choiceOutput(
        place,
        resolution.choices,
        resolution.refreshed,
        retryArguments
      );
    }
    const radius = typeof rawInput.radius_km === "number"
      ? rawInput.radius_km
      : 25;
    const provisionalDate = typeof rawInput.date === "string"
      ? rawInput.date
      : current.mapState.date ?? latestCompletedUtcDate(now);
    selection = buildGeocodedPlaceSelection(
      resolution.candidate.label,
      { lon: resolution.candidate.lon, lat: resolution.candidate.lat },
      radius,
      "custom",
      `${provisionalDate}T00:00:00.000Z`,
      `${provisionalDate}T23:59:59.000Z`,
      resolution.candidate.boundingBox
    );
    resolvedNewPlace = true;
  }

  const anyEnabledAfterPatch = ENVIRONMENTAL_MAP_LAYER_IDS.some((layerId) =>
    layerPatch[layerId] ?? current.mapState.layers[layerId].visible
  );
  if (anyEnabledAfterPatch && !selection) {
    return invalidInput(
      "A current place or a place argument is required before showing environmental layers."
    );
  }

  let date: string | null;
  if (typeof rawInput.date === "string") {
    date = rawInput.date;
  } else if (current.mapState.date) {
    date = current.mapState.date;
  } else if (selection) {
    date = singleMapDateFromSelection(selection, now);
    if (date === null && anyEnabledAfterPatch) {
      return invalidInput(
        "The current selection spans multiple days. Provide one explicit UTC map date; the range will not be collapsed silently."
      );
    }
  } else {
    date = null;
  }

  if (
    selection &&
    date !== null &&
    (resolvedNewPlace || typeof rawInput.date === "string")
  ) {
    const radius = typeof rawInput.radius_km === "number"
      ? rawInput.radius_km
      : selection.analysisArea.radiusKm;
    selection = updateSelectionParams(
      selection,
      radius,
      "custom",
      `${date}T00:00:00.000Z`,
      `${date}T23:59:59.000Z`
    );
  } else if (selection && typeof rawInput.radius_km === "number") {
    selection = updateSelectionParams(
      selection,
      rawInput.radius_km,
      selection.timeSelection.type,
      selection.timeSelection.startTs,
      selection.timeSelection.endTs
    );
  }

  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
  if (!isCurrentInvocation() || !isCurrentContext()) {
    return {
      status: "superseded",
      message:
        "A newer map request replaced this request before its update could be applied.",
      ui_updated: false,
    };
  }
  const result = dependencies.applyUpdate({
    selection,
    date,
    layers: layerPatch,
    origin: "agent",
  });
  return {
    status: "success",
    ui_updated: true,
    analysis_cleared: result.analysisCleared,
    selected_place: selection ? {
      label: selection.label,
      longitude: selection.coordinate.lon,
      latitude: selection.coordinate.lat,
      radius_km: selection.analysisArea.radiusKm,
      bounding_box: selection.placeBoundingBox ?? null,
    } : null,
    map_date: result.mapState.date,
    map_state_revision: result.mapState.revision,
    layers: outputLayers(result.mapState),
    boundary:
      "Map layers are visualization-only. Source failure, zero detections, no rendered observation, or a no-visible-pixels check is not evidence of no hazard, safety, severity, amount, perimeter, depth, or property impact.",
  };
}

export function createSetEnvironmentalMapLayersTool(
  dependencies: SetEnvironmentalMapLayersDependencies
): WebMCP.ModelContextTool {
  let latestInvocation = 0;
  const coordinatedDependencies = dependencies.beginInvocation
    ? dependencies
    : {
        ...dependencies,
        beginInvocation: () => {
          const invocation = ++latestInvocation;
          return () => invocation === latestInvocation;
        },
      };
  return {
    name: SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME,
    title: "Set environmental map layers",
    description:
      "Show or hide Sky to Porch environmental map imagery for one place and one UTC date. Use for visual map requests involving rain imagery, land-surface heat imagery, recent FIRMS thermal-anomaly pixels, or 3-day flood-extent imagery. Inputs are desired-state patches: omitted layers remain unchanged and repeated identical calls are safe. Use look_up_place_location for read-only coordinates/bounds, environmental analysis for conditions, amounts, severity, impact or safety, and source coverage for eligibility. Imagery is visualization-only.",
    inputSchema: SET_ENVIRONMENTAL_MAP_LAYERS_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: true,
    },
    execute: (input, options) =>
      executeSetEnvironmentalMapLayersTool(input, options, coordinatedDependencies),
  };
}
