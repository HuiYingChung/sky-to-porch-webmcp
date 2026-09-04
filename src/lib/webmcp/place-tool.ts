import {
  GEOCODE_ATTRIBUTION,
  PLACE_CHOICE_ID_PATTERN_SOURCE,
  PLACE_CHOICE_ID_RE,
  resolveNamedPlace,
  validPlaceQuery,
  type AgentPlaceChoice,
} from "@/lib/webmcp/place-resolution";
import type { GeocodeAdminContext } from "@/lib/location/geocode";

export const LOOK_UP_PLACE_LOCATION_TOOL_NAME = "look_up_place_location";

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

interface PlaceLookupDependencies {
  fetchImpl?: typeof fetch;
}

export type PlaceLookupOutput =
  | {
      status: "success";
      canonical_label: string;
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
      attribution: typeof GEOCODE_ATTRIBUTION;
      source: {
        geocoder: "Photon";
        data: "OpenStreetMap";
        url: "https://photon.komoot.io/";
      };
      ui_updated: false;
    }
  | {
      status:
        | "invalid_input"
        | "place_not_found"
        | "place_lookup_failed"
        | "needs_place_choice";
      message: string;
      ui_updated: false;
      reason?: "rate_limited";
      choices?: AgentPlaceChoice[];
      requires_user_input?: true;
      required_next_action?: "ask_user_to_choose_place_and_wait";
      must_not_select_place?: true;
      must_not_retry_before_user_reply?: true;
      after_user_choice?: {
        required_next_action: "retry_place_lookup_with_selected_place";
        preserve_original_place: true;
        set_place_choice_id_to_selected_choice_id: true;
        retry_with_original_arguments: { place: string };
      };
    };

function invalidInput(message: string): PlaceLookupOutput {
  return { status: "invalid_input", message, ui_updated: false };
}

function choiceOutput(
  place: string,
  choices: AgentPlaceChoice[],
  refreshed: boolean
): PlaceLookupOutput {
  return {
    status: "needs_place_choice",
    message: `PAUSE FOR USER: ${refreshed
      ? "The previous place choice is stale; refreshed results now contain"
      : "Place search found"} ${choices.length} possible place${choices.length === 1 ? "" : "s"} for “${place}”. Ask the person to choose one, wait for a new message, then retry with the original place and the selected choice_id.`,
    ui_updated: false,
    choices,
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
  };
}

export async function executeLookUpPlaceLocationTool(
  rawInput: Record<string, unknown>,
  options: WebMCP.ToolExecuteCallbackOptions | undefined,
  dependencies: PlaceLookupDependencies = {}
): Promise<PlaceLookupOutput> {
  const keys = Object.keys(rawInput);
  if (keys.some((key) => key !== "place" && key !== "place_choice_id")) {
    return invalidInput("Only place and place_choice_id are accepted.");
  }
  if (!validPlaceQuery(rawInput.place)) {
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

  const signal = options?.signal ?? new AbortController().signal;
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Tool execution cancelled", "AbortError");
  }
  const place = rawInput.place.trim();
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
        : "Place search was unavailable; no location was inferred.",
      ui_updated: false,
      ...(resolution.reason ? { reason: resolution.reason } : {}),
    };
  }
  if (resolution.status === "needs_place_choice") {
    return choiceOutput(place, resolution.choices, resolution.refreshed);
  }

  const { candidate } = resolution;
  return {
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
    source: {
      geocoder: "Photon",
      data: "OpenStreetMap",
      url: "https://photon.komoot.io/",
    },
    ui_updated: false,
  };
}

export function createLookUpPlaceLocationTool(
  dependencies: PlaceLookupDependencies = {}
): WebMCP.ModelContextTool {
  return {
    name: LOOK_UP_PLACE_LOCATION_TOOL_NAME,
    title: "Look up place location",
    description:
      "Use this when the person asks for a place's normalized name, WGS84 coordinates, bounding box, or available administrative context. This is a read-only Photon/OpenStreetMap lookup. Do not use it to display imagery (use the environmental map layer tool), assess conditions, amounts, severity, evidence, impact, or safety (use environmental analysis), or check source eligibility/coverage (use source coverage).",
    inputSchema: LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    execute: (input, options) =>
      executeLookUpPlaceLocationTool(input, options, dependencies),
  };
}
