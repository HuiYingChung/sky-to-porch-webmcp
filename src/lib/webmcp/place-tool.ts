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
} as const;

const PLACE_RESPONSE_CONTRACT = {
  style: "plain_english" as const,
  use_place_labels_and_geography: true as const,
  never_repeat_choice_tokens_or_internal_field_names: true as const,
};

function toolCancellationError(): DOMException {
  return new DOMException("Tool execution cancelled", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

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
  };
  bounding_box: null | {
    west: number;
    south: number;
    east: number;
    north: number;
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

export type AgentPlaceLookupOperation =
  | "place_lookup"
  | "analysis"
  | "comparison"
  | "map";

export interface AgentPlaceLookupFeedbackContext {
  query: string;
  operation: AgentPlaceLookupOperation;
  context_label?: string;
}

type AgentPlaceLookupReceiptContext = AgentPlaceLookupFeedbackContext;

interface AgentPlaceLookupPendingReceipt extends AgentPlaceLookupReceiptContext {
  status: "lookup_pending";
  message: string;
  ui_updated: true;
  map_updated: false;
  map_unchanged: true;
}

interface AgentPlaceResolvedReceipt extends AgentPlaceLookupReceiptContext {
  status: "place_resolved";
  message: string;
  canonical_label: string;
  representative_point: PlaceLookupGeographicChoice["representative_point"];
  bounding_box: PlaceLookupGeographicChoice["bounding_box"];
  admin_context: GeocodeAdminContext;
  attribution: typeof GEOCODE_ATTRIBUTION;
  source: typeof PLACE_SOURCE;
  ui_updated: true;
  map_updated: boolean;
  map_unchanged: boolean;
}

interface AgentPlaceLookupSupersededReceipt extends AgentPlaceLookupReceiptContext {
  status: "superseded";
  message: string;
  ui_updated: true;
  map_updated: false;
  map_unchanged: true;
}

export type AgentPlaceLookupCompletedReceipt = (
  | Exclude<PlaceLookupOutput, PlaceLookupSuperseded>
  | AgentPlaceResolvedReceipt
  | AgentPlaceLookupSupersededReceipt
) & AgentPlaceLookupReceiptContext;

export type AgentPlaceLookupReceiptPayload =
  | AgentPlaceLookupPendingReceipt
  | AgentPlaceLookupCompletedReceipt
  | (Exclude<PlaceLookupOutput, PlaceLookupSuperseded> & {
      /** Legacy standalone lookup receipt shape; retained for compatibility. */
      query: string | null;
      operation?: "place_lookup";
      context_label?: string;
    });

export interface AgentPlaceLookupFeedbackSession {
  isCurrent: () => boolean;
  publish: (feedback: AgentPlaceLookupCompletedReceipt) => Promise<boolean>;
}

export interface BeginAgentPlaceLookupFeedbackOptions {
  announcePending?: boolean;
}

export type BeginAgentPlaceLookupFeedback = (
  context: AgentPlaceLookupFeedbackContext,
  options?: BeginAgentPlaceLookupFeedbackOptions
) => Promise<AgentPlaceLookupFeedbackSession>;

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
  /** Publishes one visible, cross-tool place-search lifecycle. */
  beginPlaceLookupFeedback?: BeginAgentPlaceLookupFeedback;
}

export function placeLookupGeographicChoice(
  candidate: ResolvedPlaceCandidate
): PlaceLookupGeographicChoice {
  return {
    choice_id: placeChoiceId(candidate),
    label: candidate.label,
    representative_point: {
      longitude: candidate.lon,
      latitude: candidate.lat,
    },
    bounding_box: candidate.boundingBox
      ? { ...candidate.boundingBox }
      : null,
    admin_context: candidate.adminContext,
  };
}

function operationTarget(operation: AgentPlaceLookupOperation): string {
  if (operation === "analysis") return "environmental check";
  if (operation === "comparison") return "comparison";
  if (operation === "map") return "map update";
  return "map";
}

export function placeLookupPendingReceipt(
  context: AgentPlaceLookupFeedbackContext,
  previousQuery?: string
): AgentPlaceLookupPendingReceipt {
  const replacementNotice = previousQuery
    ? `The earlier search for “${previousQuery}” stopped because this newer request took its place. `
    : "";
  return {
    ...context,
    status: "lookup_pending",
    message: `${replacementNotice}Looking for “${context.query}” before continuing the ${operationTarget(context.operation)}. Your current map and results stay in place while we check.`,
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  };
}

export function placeLookupResolvedReceipt(
  context: AgentPlaceLookupFeedbackContext,
  candidate: ResolvedPlaceCandidate,
  mapUpdated = false
): AgentPlaceResolvedReceipt {
  const choice = placeLookupGeographicChoice(candidate);
  return {
    ...context,
    status: "place_resolved",
    message: mapUpdated
      ? `We found “${candidate.label}” and updated the map.`
      : `We found “${candidate.label}”. The ${operationTarget(context.operation)} can continue.`,
    canonical_label: candidate.label,
    representative_point: choice.representative_point,
    bounding_box: choice.bounding_box,
    admin_context: choice.admin_context,
    attribution: GEOCODE_ATTRIBUTION,
    source: PLACE_SOURCE,
    ui_updated: true,
    map_updated: mapUpdated,
    map_unchanged: !mapUpdated,
  };
}

export function placeLookupChoiceReceipt(
  context: AgentPlaceLookupFeedbackContext,
  candidates: ResolvedPlaceCandidate[],
  refreshed = false
): AgentPlaceLookupCompletedReceipt {
  return {
    ...context,
    status: "needs_place_choice",
    message: `${refreshed ? "The earlier choice is no longer available. " : ""}Several places matched “${context.query}”. Review every option, choose one, and then continue the ${operationTarget(context.operation)}. Your current map and results have not changed.`,
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
    choices: candidates.map(placeLookupGeographicChoice),
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
      retry_with_original_arguments: { place: context.query },
    },
  };
}

export function placeLookupFailureReceipt(
  context: AgentPlaceLookupFeedbackContext,
  status: "place_not_found" | "place_lookup_failed",
  reason?: "rate_limited"
): AgentPlaceLookupCompletedReceipt {
  const message = status === "place_not_found"
    ? `We couldn’t find a place matching “${context.query}”. Try a more specific name. Your current map and results have not changed.`
    : reason === "rate_limited"
      ? "There were too many place searches at once. Wait a moment and try again. Your current map and results have not changed."
      : "Place search is temporarily unavailable. Please try again in a moment. Your current map and results have not changed.";
  return {
    ...context,
    status,
    message,
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
    ...(reason ? { reason } : {}),
  };
}

export function placeLookupInvalidRequestReceipt(
  context: AgentPlaceLookupFeedbackContext
): AgentPlaceLookupCompletedReceipt {
  const requestName = context.operation === "analysis"
    ? "environmental check"
    : context.operation === "comparison"
      ? "comparison"
      : context.operation === "map"
        ? "map update"
        : "place search";
  const guidance = context.operation === "map"
    ? "Check the place, date, area size, and map choices, then try again."
    : context.operation === "place_lookup"
      ? "Enter a place name or choose a point on the map, then try again."
      : "Check the place, topic, date, and area size, then try again.";
  return {
    ...context,
    status: "invalid_input",
    message: `We couldn’t start this ${requestName}. ${guidance} Your current map and results have not changed.`,
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  };
}

export function placeLookupSupersededReceipt(
  context: AgentPlaceLookupFeedbackContext
): AgentPlaceLookupSupersededReceipt {
  return {
    ...context,
    status: "superseded",
    message: `The search for “${context.query}” stopped because a newer request or selection took its place. Your current map and results were not changed by the older search.`,
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  };
}

async function publishResult<
  T extends Exclude<PlaceLookupOutput, PlaceLookupSuperseded>
>(
  output: T,
  query: string | null,
  dependencies: PlaceLookupDependencies,
  feedbackSession?: AgentPlaceLookupFeedbackSession
): Promise<T> {
  if (feedbackSession && query !== null) {
    await feedbackSession.publish({
      ...output,
      query,
      operation: "place_lookup",
    });
  } else {
    await dependencies.publishFeedback({ ...output, query });
  }
  return output;
}

async function invalidInput(
  message: string,
  query: string | null,
  dependencies: PlaceLookupDependencies
): Promise<PlaceLookupFailure> {
  const output: PlaceLookupFailure = {
    status: "invalid_input",
    message,
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  };
  if (dependencies.beginPlaceLookupFeedback) {
    const context: AgentPlaceLookupFeedbackContext = {
      query: query ?? "",
      operation: "place_lookup",
    };
    const session = await dependencies.beginPlaceLookupFeedback(
      context,
      { announcePending: false }
    );
    await session.publish(placeLookupInvalidRequestReceipt(context));
    return output;
  }
  return publishResult(output, query, dependencies);
}

async function choiceOutput(
  place: string,
  candidates: ResolvedPlaceCandidate[],
  refreshed: boolean,
  dependencies: PlaceLookupDependencies,
  feedbackSession?: AgentPlaceLookupFeedbackSession
): Promise<PlaceLookupChoiceRequired> {
  const choices = candidates.map(placeLookupGeographicChoice);
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
  }, place, dependencies, feedbackSession);
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
    throw toolCancellationError();
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
  const feedbackContext: AgentPlaceLookupFeedbackContext = {
    query: place,
    operation: "place_lookup",
  };
  const feedbackSession = await dependencies.beginPlaceLookupFeedback?.(
    feedbackContext
  );
  const publishSupersededFeedback = async () => {
    await feedbackSession?.publish(
      placeLookupSupersededReceipt(feedbackContext)
    );
  };
  const current = dependencies.readState();
  let resolution: Awaited<ReturnType<typeof resolveNamedPlace>>;
  try {
    resolution = await resolveNamedPlace(
      place,
      typeof rawInput.place_choice_id === "string"
        ? rawInput.place_choice_id
        : undefined,
      dependencies.fetchImpl ?? fetch,
      signal,
      MAX_PLACE_LOOKUP_CHOICES
    );
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      await publishSupersededFeedback();
      throw toolCancellationError();
    }
    return publishResult({
      status: "place_lookup_failed",
      message: "Place search is temporarily unavailable. Please try again in a moment. Your current map and results are unchanged.",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
    }, place, dependencies, feedbackSession);
  }
  if (signal.aborted) {
    await publishSupersededFeedback();
    throw toolCancellationError();
  }
  if (!isCurrentInvocation() || !isCurrentContext()) {
    await publishSupersededFeedback();
    return superseded(
      "This search stopped because a newer request started."
    );
  }
  const latest = dependencies.readState();
  if (!dependencies.beginContextInvocation && (
    latest.mapState.contextRevision !== current.mapState.contextRevision ||
    !sameMapSelection(latest.placeSelection, current.placeSelection)
  )) {
    await publishSupersededFeedback();
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
    }, place, dependencies, feedbackSession);
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
    }, place, dependencies, feedbackSession);
  }
  if (resolution.status === "needs_place_choice") {
    return choiceOutput(
      place,
      resolution.candidates,
      resolution.refreshed,
      dependencies,
      feedbackSession
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
    await publishSupersededFeedback();
    throw toolCancellationError();
  }
  if (!isCurrentInvocation() || !isCurrentContext()) {
    await publishSupersededFeedback();
    return superseded(
      "This search stopped because a newer request started."
    );
  }

  const selectionUpdated = !sameMapSelection(current.placeSelection, selection);
  const isCurrentMutation = dependencies.beginContextMutationInvocation?.() ??
    (() => true);
  if (!isCurrentInvocation() || !isCurrentMutation()) {
    await publishSupersededFeedback();
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
    },
    bounding_box: candidate.boundingBox
      ? { ...candidate.boundingBox }
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
  }, place, dependencies, feedbackSession);
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
    execute: async (input, options) => {
      const output = await executeLookUpPlaceLocationTool(
        input,
        options,
        coordinatedDependencies
      );
      if (output.status === "success") {
        const {
          map_state_revision: omittedMapStateRevision,
          map_focus_revision: omittedMapFocusRevision,
          ...publicOutput
        } = output;
        void omittedMapStateRevision;
        void omittedMapFocusRevision;
        return {
          ...publicOutput,
          agent_response_contract: PLACE_RESPONSE_CONTRACT,
        };
      }
      return {
        ...output,
        agent_response_contract: PLACE_RESPONSE_CONTRACT,
      };
    },
  };
}
