import type { GeocodeAdminContext } from "@/lib/location/geocode";
import {
  buildGeocodedPlaceSelection,
  type PlaceSelection,
} from "@/lib/location/selection";
import {
  latestCompletedUtcDate,
  sameMapSelection,
  singleMapDateFromSelection,
} from "@/lib/map/environmental-map-state";
import type {
  EnvironmentalMapToolSnapshot,
  EnvironmentalMapToolUpdate,
  EnvironmentalMapToolUpdateResult,
} from "@/lib/webmcp/map-tool";
import {
  GEOCODE_ATTRIBUTION,
  MAX_PLACE_LOOKUP_CHOICES,
  PLACE_CHOICE_ID_PATTERN_SOURCE,
  PLACE_CHOICE_ID_RE,
  placeChoiceId,
  resolveNamedPlace,
  validPlaceQuery,
  type ResolvedPlaceCandidate,
} from "@/lib/webmcp/place-resolution";

export const LOOK_UP_PLACE_LOCATION_TOOL_NAME = "look_up_place_location";

const PLACE_SOURCE = {
  geocoder: "Photon",
  data: "OpenStreetMap",
  url: "https://photon.komoot.io/",
} as const;

export const LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["place"],
  properties: {
    place: {
      type: "string",
      minLength: 2,
      maxLength: 200,
      description:
        "The place name exactly as the person stated it. Keep this original query unchanged when continuing after a place choice.",
    },
    place_choice_id: {
      type: ["string", "null"],
      pattern: PLACE_CHOICE_ID_PATTERN_SOURCE,
      description:
        "Initial call: omit or use null. After an ambiguous result, copy only the person-selected choice_id exactly and keep place unchanged.",
    },
  },
} as const;

export interface PlaceLookupGeographicChoice {
  choice_id: string;
  label: string;
  representative_point: {
    longitude: number;
    latitude: number;
    crs: "WGS84";
  };
  bounding_box: null | {
    west: number;
    south: number;
    east: number;
    north: number;
    crs: "WGS84";
  };
  admin_context: GeocodeAdminContext;
}

interface PlaceLookupSuccess {
  status: "success";
  canonical_label: string;
  representative_point: PlaceLookupGeographicChoice["representative_point"];
  bounding_box: PlaceLookupGeographicChoice["bounding_box"];
  admin_context: GeocodeAdminContext;
  attribution: typeof GEOCODE_ATTRIBUTION;
  source: typeof PLACE_SOURCE;
  ui_updated: true;
  map_updated: true;
  selection_updated: boolean;
  analysis_cleared: boolean;
  selected_place: {
    label: string;
    radius_km: number;
  };
  map_date: string | null;
  map_state_revision: number;
  map_focus_revision: number;
}

interface PlaceLookupChoiceRequired {
  status: "needs_place_choice";
  message: string;
  ui_updated: true;
  map_updated: false;
  map_unchanged: true;
  choices: PlaceLookupGeographicChoice[];
  attribution: typeof GEOCODE_ATTRIBUTION;
  source: typeof PLACE_SOURCE;
  requires_user_input: true;
  required_next_action: "ask_user_to_choose_place_and_wait";
  must_not_select_place: true;
  must_not_retry_before_user_reply: true;
  after_user_choice: {
    required_next_action: "retry_place_lookup_with_selected_place";
    preserve_original_place: true;
    set_place_choice_id_to_selected_choice_id: true;
    retry_with_original_arguments: { place: string };
  };
}

interface PlaceLookupFailure {
  status: "invalid_input" | "place_not_found" | "place_lookup_failed";
  message: string;
  ui_updated: true;
  map_updated: false;
  map_unchanged: true;
  reason?: "rate_limited";
}

interface PlaceLookupSuperseded {
  status: "superseded";
  message: string;
  ui_updated: false;
  map_updated: false;
}

export type PlaceLookupOutput =
  | PlaceLookupSuccess
  | PlaceLookupChoiceRequired
  | PlaceLookupFailure
  | PlaceLookupSuperseded;

export type AgentPlaceLookupReceiptPayload = Exclude<
  PlaceLookupOutput,
  PlaceLookupSuperseded
> & { query: string | null };

export type AgentPlaceLookupReceipt = AgentPlaceLookupReceiptPayload & {
  /** Monotonic event token so repeated identical lookups are announced. */
  receipt_revision: number;
};

export interface PlaceLookupDependencies {
  readState: () => EnvironmentalMapToolSnapshot;
  applyUpdate: (
    update: EnvironmentalMapToolUpdate
  ) => EnvironmentalMapToolUpdateResult;
  publishFeedback: (
    feedback: AgentPlaceLookupReceiptPayload
  ) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Per-tool reservation used to reject an older overlapping lookup. */
  beginInvocation?: () => () => boolean;
  /** Shared, side-effect-free reservation across named-place tools. */
  beginContextInvocation?: () => () => boolean;
  /** Claim every unique resolved action so older work cannot replace its focus. */
  beginContextMutationInvocation?: () => () => boolean;
}

function geographicChoice(
  candidate: ResolvedPlaceCandidate
): PlaceLookupGeographicChoice {
  return {
    choice_id: placeChoiceId(candidate),
    label: candidate.label,
    representative_point: {
      longitude: candidate.lon,
      latitude: candidate.lat,
      crs: "WGS84",
    },
    bounding_box: candidate.boundingBox
      ? { ...candidate.boundingBox, crs: "WGS84" }
      : null,
    admin_context: candidate.adminContext,
  };
}

async function publishResult<
  T extends Exclude<PlaceLookupOutput, PlaceLookupSuperseded>
>(
  output: T,
  query: string | null,
  dependencies: PlaceLookupDependencies
): Promise<T> {
  await dependencies.publishFeedback({ ...output, query });
  return output;
}

async function invalidInput(
  message: string,
  query: string | null,
  dependencies: PlaceLookupDependencies
): Promise<PlaceLookupFailure> {
  return publishResult({
    status: "invalid_input",
    message,
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  }, query, dependencies);
}

async function choiceOutput(
  place: string,
  candidates: ResolvedPlaceCandidate[],
  refreshed: boolean,
  dependencies: PlaceLookupDependencies
): Promise<PlaceLookupChoiceRequired> {
  const choices = candidates.map(geographicChoice);
  return publishResult({
    status: "needs_place_choice",
    message: `${refreshed
      ? "The earlier choice is no longer available. We found"
      : "We found"} ${choices.length} possible place${choices.length === 1 ? "" : "s"} for “${place}”. Choose one below to continue.`,
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
    choices,
    attribution: GEOCODE_ATTRIBUTION,
    source: PLACE_SOURCE,
    requires_user_input: true,
    required_next_action: "ask_user_to_choose_place_and_wait",
    must_not_select_place: true,
    must_not_retry_before_user_reply: true,
    after_user_choice: {
      required_next_action: "retry_place_lookup_with_selected_place",
      preserve_original_place: true,
      set_place_choice_id_to_selected_choice_id: true,
      retry_with_original_arguments: { place },
    },
  }, place, dependencies);
}

function superseded(message: string): PlaceLookupSuperseded {
  return {
    status: "superseded",
    message,
    ui_updated: false,
    map_updated: false,
  };
}

export async function executeLookUpPlaceLocationTool(
  rawInput: Record<string, unknown>,
  options: WebMCP.ToolExecuteCallbackOptions | undefined,
  dependencies: PlaceLookupDependencies
): Promise<PlaceLookupOutput> {
  const signal = options?.signal ?? new AbortController().signal;
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
  const isCurrentInvocation = dependencies.beginInvocation?.() ?? (() => true);
  const isCurrentContext = dependencies.beginContextInvocation?.() ?? (() => true);
  const rawPlace = typeof rawInput.place === "string"
    ? rawInput.place.trim()
    : null;

  const keys = Object.keys(rawInput);
  if (keys.some((key) => key !== "place" && key !== "place_choice_id")) {
    return invalidInput(
      "The place lookup received extra information it does not recognize. Try again with only the place name and, after choosing from a list, that choice.",
      rawPlace,
      dependencies
    );
  }
  if (!validPlaceQuery(rawInput.place)) {
    return invalidInput(
      "Enter a place name between 2 and 200 characters.",
      rawPlace,
      dependencies
    );
  }
  if (
    rawInput.place_choice_id !== undefined &&
    rawInput.place_choice_id !== null &&
    (typeof rawInput.place_choice_id !== "string" ||
      !PLACE_CHOICE_ID_RE.test(rawInput.place_choice_id))
  ) {
    return invalidInput(
      "That place choice is no longer available. Search for the place again, then choose one of the new options.",
      rawPlace,
      dependencies
    );
  }

  const place = rawInput.place.trim();
  const current = dependencies.readState();
  const resolution = await resolveNamedPlace(
    place,
    typeof rawInput.place_choice_id === "string"
      ? rawInput.place_choice_id
      : undefined,
    dependencies.fetchImpl ?? fetch,
    signal,
    MAX_PLACE_LOOKUP_CHOICES
  );
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
  if (!isCurrentInvocation() || !isCurrentContext()) {
    return superseded(
      "This search stopped because a newer request started."
    );
  }
  const latest = dependencies.readState();
  if (!dependencies.beginContextInvocation && (
    latest.mapState.contextRevision !== current.mapState.contextRevision ||
    !sameMapSelection(latest.placeSelection, current.placeSelection)
  )) {
    return superseded(
      "This search stopped because the map’s place, date, or area changed before it finished."
    );
  }

  if (resolution.status === "place_not_found") {
    return publishResult({
      status: "place_not_found",
      message: `We couldn’t find a place matching “${place}”. Check the spelling or add a city, state or province, or country, then try again. Your current map and results are unchanged.`,
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
    }, place, dependencies);
  }
  if (resolution.status === "place_lookup_failed") {
    return publishResult({
      status: "place_lookup_failed",
      message: resolution.reason === "rate_limited"
        ? "There were too many place searches at once. Wait a moment and try again. Your current map and results are unchanged."
        : "Place search is temporarily unavailable. Please try again in a moment. Your current map and results are unchanged.",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
      ...(resolution.reason ? { reason: resolution.reason } : {}),
    }, place, dependencies);
  }
  if (resolution.status === "needs_place_choice") {
    return choiceOutput(
      place,
      resolution.candidates,
      resolution.refreshed,
      dependencies
    );
  }

  const { candidate } = resolution;
  const now = dependencies.now?.() ?? new Date();
  const previousSelection = current.placeSelection;
  const radius = previousSelection?.analysisArea.radiusKm ?? 25;
  const fallbackDate = current.mapState.date ?? latestCompletedUtcDate(now);
  const selection: PlaceSelection = buildGeocodedPlaceSelection(
    candidate.label,
    { lon: candidate.lon, lat: candidate.lat },
    radius,
    previousSelection?.timeSelection.type ?? "custom",
    previousSelection
      ? previousSelection.timeSelection.startTs
      : `${fallbackDate}T00:00:00.000Z`,
    previousSelection
      ? previousSelection.timeSelection.endTs
      : `${fallbackDate}T23:59:59.000Z`,
    candidate.boundingBox
  );
  const date = current.mapState.date ?? singleMapDateFromSelection(selection, now);
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
  if (!isCurrentInvocation() || !isCurrentContext()) {
    return superseded(
      "This search stopped because a newer request started."
    );
  }

  const selectionUpdated = !sameMapSelection(current.placeSelection, selection);
  const isCurrentMutation = dependencies.beginContextMutationInvocation?.() ??
    (() => true);
  if (!isCurrentInvocation() || !isCurrentMutation()) {
    return superseded(
      "This search stopped because a newer request started."
    );
  }
  const result = dependencies.applyUpdate({
    selection,
    date,
    layers: {},
    origin: "agent",
    focusPlace: true,
  });
  return publishResult({
    status: "success",
    canonical_label: candidate.label,
    representative_point: {
      longitude: candidate.lon,
      latitude: candidate.lat,
      crs: "WGS84",
    },
    bounding_box: candidate.boundingBox
      ? { ...candidate.boundingBox, crs: "WGS84" }
      : null,
    admin_context: candidate.adminContext,
    attribution: GEOCODE_ATTRIBUTION,
    source: PLACE_SOURCE,
    ui_updated: true,
    map_updated: true,
    selection_updated: selectionUpdated,
    analysis_cleared: result.analysisCleared,
    selected_place: {
      label: selection.label,
      radius_km: selection.analysisArea.radiusKm,
    },
    map_date: result.mapState.date,
    map_state_revision: result.mapState.revision,
    map_focus_revision: result.mapState.placeFocusRevision,
  }, place, dependencies);
}

export function createLookUpPlaceLocationTool(
  dependencies: PlaceLookupDependencies
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
    name: LOOK_UP_PLACE_LOCATION_TOOL_NAME,
    title: "Look up and select a place",
    description:
      "Find a place's standard name, coordinates, approximate area, and nearby region names. One clear result selects and frames that place on Sky to Porch's shared live map while keeping the current area size, date, and requested layers. If several places match, the page shows every checked option and asks the person to choose. If the search fails, the page explains what happened. These unfinished searches never move the map or clear existing results. Do not use this to assess environmental conditions, severity, impact, or safety.",
    inputSchema: LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: true,
    },
    execute: (input, options) =>
      executeLookUpPlaceLocationTool(input, options, coordinatedDependencies),
  };
}
