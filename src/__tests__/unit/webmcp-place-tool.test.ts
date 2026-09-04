/// <reference types="webmcp-types" />

import { describe, expect, it, vi } from "vitest";
import {
  LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA,
  LOOK_UP_PLACE_LOCATION_TOOL_NAME,
  createLookUpPlaceLocationTool,
  executeLookUpPlaceLocationTool,
  type AgentPlaceLookupReceiptPayload,
  type PlaceLookupDependencies,
} from "@/lib/webmcp/place-tool";
import { PLACE_CHOICE_ID_RE } from "@/lib/webmcp/place-resolution";
import {
  applyEnvironmentalMapDesiredState,
  createInitialEnvironmentalMapState,
  sameMapSelection,
  type EnvironmentalMapState,
} from "@/lib/map/environmental-map-state";
import {
  buildGeocodedPlaceSelection,
  type PlaceSelection,
} from "@/lib/location/selection";

const NOW = new Date("2026-08-26T18:00:00.000Z");

function toolOptions(
  signal = new AbortController().signal
): WebMCP.ToolExecuteCallbackOptions {
  return { signal };
}

function geocodeResponse(
  results: Array<Record<string, unknown>>,
  status = 200
): Response {
  return new Response(JSON.stringify({ ok: status >= 200 && status < 300, results }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function selection(
  label = "Austin, Texas",
  lon = -97.7431,
  lat = 30.2672
): PlaceSelection {
  return buildGeocodedPlaceSelection(
    label,
    { lon, lat },
    40,
    "custom",
    "2026-08-25T00:00:00.000Z",
    "2026-08-25T23:59:59.000Z"
  );
}

function stateWithDate(date = "2026-08-25"): EnvironmentalMapState {
  return { ...createInitialEnvironmentalMapState(), date };
}

function harness(
  fetchImpl: typeof fetch = vi.fn(),
  placeSelection: PlaceSelection | null = selection(),
  mapState: EnvironmentalMapState = stateWithDate()
) {
  let snapshot = { placeSelection, mapState };
  let latestInvocation = 0;
  let latestContextInvocation = 0;
  const publishFeedback = vi.fn<(feedback: AgentPlaceLookupReceiptPayload) => void>();
  const applyUpdate: PlaceLookupDependencies["applyUpdate"] = vi.fn((update) => {
    const contextChanged =
      !sameMapSelection(snapshot.placeSelection, update.selection) ||
      snapshot.mapState.date !== update.date;
    const nextMapState = applyEnvironmentalMapDesiredState(
      snapshot.mapState,
      update.layers,
      {
        date: update.date,
        contextChanged,
        origin: update.origin,
        focusPlace: update.focusPlace,
        now: NOW,
      }
    );
    snapshot = { placeSelection: update.selection, mapState: nextMapState };
    return { mapState: nextMapState, analysisCleared: contextChanged };
  });
  const dependencies = {
    readState: () => snapshot,
    applyUpdate,
    publishFeedback,
    fetchImpl,
    now: () => NOW,
    beginInvocation: () => {
      const invocation = ++latestInvocation;
      return () => invocation === latestInvocation;
    },
    beginContextInvocation: () => {
      const invocation = ++latestContextInvocation;
      return () => invocation === latestContextInvocation;
    },
    beginContextMutationInvocation: () => {
      const invocation = ++latestContextInvocation;
      return () => invocation === latestContextInvocation;
    },
  } satisfies PlaceLookupDependencies;

  return {
    dependencies,
    applyUpdate,
    publishFeedback,
    readSnapshot: () => snapshot,
    replaceMapState: (nextMapState: EnvironmentalMapState) => {
      snapshot = { ...snapshot, mapState: nextMapState };
    },
  };
}

describe("look_up_place_location WebMCP tool", () => {
  it("publishes a fixed shared-map lookup contract", () => {
    const { dependencies } = harness();
    const tool = createLookUpPlaceLocationTool(dependencies);

    expect(LOOK_UP_PLACE_LOCATION_TOOL_NAME).toBe("look_up_place_location");
    expect(tool.name).toBe(LOOK_UP_PLACE_LOCATION_TOOL_NAME);
    expect(tool.inputSchema).toBe(LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: true,
    });
    expect(LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["place"],
      properties: {
        place: { type: "string", minLength: 2, maxLength: 200 },
        place_choice_id: { type: ["string", "null"] },
      },
    });
  });

  it("selects a unique result on the shared map and publishes the visible success", async () => {
    const fetchImpl = vi.fn(async () => geocodeResponse([{
      id: "osm-r-2688911",
      label: "Houston, Texas, United States",
      lon: -95.3676974,
      lat: 29.7589382,
      boundingBox: {
        west: -95.9,
        south: 29.5,
        east: -95,
        north: 30.1,
      },
      adminContext: {
        city: "Houston",
        county: "Harris County",
        state: "Texas",
        country: "United States",
        countryCode: "US",
      },
    }]));

    const current = applyEnvironmentalMapDesiredState(
      stateWithDate(),
      { rain_satellite: true },
      { date: "2026-08-25", contextChanged: false, origin: "human", now: NOW }
    );
    const testHarness = harness(fetchImpl, selection(), current);
    const output = await executeLookUpPlaceLocationTool(
      { place: "  Houston  " },
      toolOptions(),
      testHarness.dependencies
    );

    expect(fetchImpl).toHaveBeenCalledWith("/api/geocode", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ query: "Houston" }),
    }));
    expect(testHarness.applyUpdate).toHaveBeenCalledTimes(1);
    expect(testHarness.applyUpdate).toHaveBeenCalledWith({
      selection: expect.objectContaining({
        label: "Houston, Texas, United States (place search result)",
        coordinate: { lon: -95.3676974, lat: 29.7589382 },
        placeBoundingBox: {
          west: -95.9,
          south: 29.5,
          east: -95,
          north: 30.1,
        },
        analysisArea: expect.objectContaining({ radiusKm: 40 }),
      }),
      date: "2026-08-25",
      layers: {},
      origin: "agent",
      focusPlace: true,
    });
    expect(output).toEqual({
      status: "success",
      canonical_label: "Houston, Texas, United States",
      representative_point: {
        longitude: -95.3676974,
        latitude: 29.7589382,
        crs: "WGS84",
      },
      bounding_box: {
        west: -95.9,
        south: 29.5,
        east: -95,
        north: 30.1,
        crs: "WGS84",
      },
      admin_context: {
        city: "Houston",
        county: "Harris County",
        state: "Texas",
        country: "United States",
        countryCode: "US",
      },
      attribution: "Search results © OpenStreetMap contributors, via Photon (komoot)",
      source: {
        geocoder: "Photon",
        data: "OpenStreetMap",
        url: "https://photon.komoot.io/",
      },
      ui_updated: true,
      map_updated: true,
      selection_updated: true,
      analysis_cleared: true,
      selected_place: {
        label: "Houston, Texas, United States (place search result)",
        radius_km: 40,
      },
      map_date: "2026-08-25",
      map_state_revision: 2,
      map_focus_revision: 1,
    });
    expect(testHarness.publishFeedback).toHaveBeenCalledOnce();
    expect(testHarness.publishFeedback).toHaveBeenCalledWith({
      ...output,
      query: "Houston",
    });
    expect(testHarness.readSnapshot().mapState.layers.rain_satellite.visible).toBe(true);
  });

  it("refocuses an already selected place without clearing matching results", async () => {
    const existingSelection = selection(
      "Houston, Texas, United States",
      -95.3698,
      29.7604
    );
    const current = applyEnvironmentalMapDesiredState(
      stateWithDate(),
      { rain_satellite: true },
      { date: "2026-08-25", contextChanged: false, origin: "human", now: NOW }
    );
    const testHarness = harness(
      vi.fn(async () => geocodeResponse([{
        id: "osm-houston",
        label: "Houston, Texas, United States",
        lon: -95.3698,
        lat: 29.7604,
      }])),
      existingSelection,
      current
    );

    const output = await executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(),
      testHarness.dependencies
    );

    expect(output).toMatchObject({
      status: "success",
      ui_updated: true,
      map_updated: true,
      selection_updated: false,
      analysis_cleared: false,
      map_state_revision: current.revision,
      map_focus_revision: current.placeFocusRevision + 1,
    });
    expect(testHarness.readSnapshot().mapState).toMatchObject({
      agentFocusRevision: current.agentFocusRevision + 1,
      placeFocusRevision: current.placeFocusRevision + 1,
      layers: { rain_satellite: { visible: true } },
    });
    expect(testHarness.applyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      focusPlace: true,
    }));
  });

  it("shows every bounded candidate with geographic details and waits for a choice", async () => {
    const candidates = [
      {
        id: "osm-il",
        label: "Springfield, Illinois, United States",
        lon: -89.65,
        lat: 39.78,
        boundingBox: { west: -89.8, south: 39.65, east: -89.5, north: 39.9 },
        adminContext: {
          city: "Springfield",
          county: "Sangamon County",
          state: "Illinois",
          country: "United States",
          countryCode: "US",
        },
      },
      {
        id: "osm-mo",
        label: "Springfield, Missouri, United States",
        lon: -93.29,
        lat: 37.21,
        boundingBox: { west: -93.5, south: 37.05, east: -93.1, north: 37.35 },
        adminContext: { city: "Springfield", state: "Missouri", country: "United States" },
      },
      {
        id: "osm-ma",
        label: "Springfield, Massachusetts, United States",
        lon: -72.59,
        lat: 42.1,
        boundingBox: { west: -72.7, south: 42, east: -72.45, north: 42.2 },
        adminContext: { city: "Springfield", state: "Massachusetts", country: "United States" },
      },
      {
        id: "osm-or",
        label: "Springfield, Oregon, United States",
        lon: -123.02,
        lat: 44.05,
        boundingBox: { west: -123.15, south: 43.95, east: -122.9, north: 44.15 },
        adminContext: { city: "Springfield", state: "Oregon", country: "United States" },
      },
      {
        id: "osm-oh",
        label: "Springfield, Ohio, United States",
        lon: -83.81,
        lat: 39.92,
        boundingBox: { west: -83.95, south: 39.8, east: -83.65, north: 40.05 },
        adminContext: { city: "Springfield", state: "Ohio", country: "United States" },
      },
      // The resolver intentionally inspects a bounded maximum of five rows.
      { id: "osm-extra", label: "Springfield, Extra", lon: -100, lat: 40 },
    ];
    const fetchImpl = vi.fn(async () => geocodeResponse(candidates));
    const testHarness = harness(fetchImpl);

    const output = await executeLookUpPlaceLocationTool(
      { place: "Springfield", place_choice_id: null },
      toolOptions(),
      testHarness.dependencies
    );

    expect(output).toMatchObject({
      status: "needs_place_choice",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
      choices: [
        {
          choice_id: "place-osm-il",
          label: "Springfield, Illinois, United States",
          representative_point: { longitude: -89.65, latitude: 39.78, crs: "WGS84" },
          bounding_box: {
            west: -89.8,
            south: 39.65,
            east: -89.5,
            north: 39.9,
            crs: "WGS84",
          },
          admin_context: {
            city: "Springfield",
            county: "Sangamon County",
            state: "Illinois",
            country: "United States",
            countryCode: "US",
          },
        },
        { choice_id: "place-osm-mo", representative_point: { longitude: -93.29 } },
        { choice_id: "place-osm-ma", representative_point: { longitude: -72.59 } },
        { choice_id: "place-osm-or", representative_point: { longitude: -123.02 } },
        { choice_id: "place-osm-oh", representative_point: { longitude: -83.81 } },
      ],
      requires_user_input: true,
      required_next_action: "ask_user_to_choose_place_and_wait",
      must_not_select_place: true,
      must_not_retry_before_user_reply: true,
      after_user_choice: {
        required_next_action: "retry_place_lookup_with_selected_place",
        preserve_original_place: true,
        set_place_choice_id_to_selected_choice_id: true,
        retry_with_original_arguments: { place: "Springfield" },
      },
    });
    const choices = output.status === "needs_place_choice" ? output.choices : [];
    expect(choices).toHaveLength(5);
    for (const choice of choices) {
      expect(choice).toEqual(expect.objectContaining({
        choice_id: expect.stringMatching(PLACE_CHOICE_ID_RE),
        label: expect.any(String),
        representative_point: {
          longitude: expect.any(Number),
          latitude: expect.any(Number),
          crs: "WGS84",
        },
        bounding_box: expect.objectContaining({ crs: "WGS84" }),
        admin_context: expect.any(Object),
      }));
    }
    expect("message" in output ? output.message : "").toContain(
      "Choose one below to continue"
    );
    expect("message" in output ? output.message : "").not.toMatch(
      /PAUSE FOR USER|place_choice_id|WGS84|revision/u
    );
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).toHaveBeenCalledWith({
      ...output,
      query: "Springfield",
    });
    expect(testHarness.readSnapshot().placeSelection).toEqual(selection());
  });

  it("distinguishes same-coordinate candidates and continues with the selected fallback id", async () => {
    const candidates = [
      { label: "Washington County, Alabama", lon: -88.206, lat: 31.409 },
      { label: "Washington County, Mississippi", lon: -88.206, lat: 31.409 },
    ];
    const fetchImpl = vi.fn(async () => geocodeResponse(candidates));
    const testHarness = harness(fetchImpl);

    const ambiguous = await executeLookUpPlaceLocationTool(
      { place: "Washington County" },
      toolOptions(),
      testHarness.dependencies
    );

    expect(ambiguous.status).toBe("needs_place_choice");
    if (ambiguous.status !== "needs_place_choice" || !ambiguous.choices) {
      throw new Error("Expected same-coordinate candidates to remain ambiguous");
    }
    const [first, second] = ambiguous.choices;
    expect(first.choice_id).not.toBe(second.choice_id);
    expect(first.choice_id).toMatch(PLACE_CHOICE_ID_RE);
    expect(second.choice_id).toMatch(PLACE_CHOICE_ID_RE);

    const selected = await executeLookUpPlaceLocationTool(
      {
        place: "Washington County",
        place_choice_id: second.choice_id,
      },
      toolOptions(),
      testHarness.dependencies
    );

    expect(selected).toMatchObject({
      status: "success",
      canonical_label: "Washington County, Mississippi",
      representative_point: { longitude: -88.206, latitude: 31.409 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed when one upstream id identifies conflicting places", async () => {
    const fetchImpl = vi.fn(async () => geocodeResponse([
      { id: "osm-conflict", label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
      { id: "osm-conflict", label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
    ]));

    const testHarness = harness(fetchImpl);
    const output = await executeLookUpPlaceLocationTool(
      { place: "Springfield" },
      toolOptions(),
      testHarness.dependencies
    );
    expect(output).toEqual({
      status: "place_lookup_failed",
      message: "Place search is temporarily unavailable. Please try again in a moment. Your current map and results are unchanged.",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
    });
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).toHaveBeenCalledWith({
      ...output,
      query: "Springfield",
    });
  });

  it("shows a visible not-found message without changing the map", async () => {
    const fetchImpl = vi.fn(async () => geocodeResponse([]));
    const testHarness = harness(fetchImpl);
    const before = testHarness.readSnapshot();

    const output = await executeLookUpPlaceLocationTool(
      { place: "Atlantis" },
      toolOptions(),
      testHarness.dependencies
    );

    expect(output).toEqual({
      status: "place_not_found",
      message: "We couldn’t find a place matching “Atlantis”. Check the spelling or add a city, state or province, or country, then try again. Your current map and results are unchanged.",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
    });
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).toHaveBeenCalledWith({
      ...output,
      query: "Atlantis",
    });
    expect(testHarness.readSnapshot()).toBe(before);
  });

  it.each([
    { ok: true },
    { ok: true, results: {} },
  ])("treats malformed successful geocoder envelope %# as a source failure", async (payload) => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify(payload),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));

    const testHarness = harness(fetchImpl);
    const output = await executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(),
      testHarness.dependencies
    );
    expect(output).toEqual({
      status: "place_lookup_failed",
      message: "Place search is temporarily unavailable. Please try again in a moment. Your current map and results are unchanged.",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
    });
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).toHaveBeenCalledWith({
      ...output,
      query: "Houston",
    });
  });

  it("drops a route bounding box that does not contain its representative point", async () => {
    const fetchImpl = vi.fn(async () => geocodeResponse([{
      id: "osm-houston",
      label: "Houston, Texas",
      lon: -95.3677,
      lat: 29.7589,
      boundingBox: { west: -80, south: 25, east: -79, north: 26 },
    }]));

    const testHarness = harness(fetchImpl);
    const output = await executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(),
      testHarness.dependencies
    );

    expect(output).toMatchObject({
      status: "success",
      canonical_label: "Houston, Texas",
      bounding_box: null,
    });
  });

  it("does not let repeated leading rows hide a later ambiguous place", async () => {
    const repeated = {
      id: "osm-springfield-il",
      label: "Springfield, Illinois",
      lon: -89.65,
      lat: 39.78,
    };
    const fetchImpl = vi.fn(async () => geocodeResponse([
      repeated,
      { ...repeated },
      { ...repeated },
      {
        id: "osm-springfield-mo",
        label: "Springfield, Missouri",
        lon: -93.29,
        lat: 37.21,
      },
    ]));

    const testHarness = harness(fetchImpl);
    const output = await executeLookUpPlaceLocationTool(
      { place: "Springfield" },
      toolOptions(),
      testHarness.dependencies
    );

    expect(output).toMatchObject({
      status: "needs_place_choice",
      choices: [
        { choice_id: "place-osm-springfield-il" },
        { choice_id: "place-osm-springfield-mo" },
      ],
    });
  });

  it("fails closed with refreshed choices when a previous choice id is stale", async () => {
    const fetchImpl = vi.fn(async () => geocodeResponse([
      { id: "osm-new-a", label: "Houston, Texas", lon: -95.36, lat: 29.75 },
      { id: "osm-new-b", label: "Houston County, Texas", lon: -95.39, lat: 31.33 },
    ]));

    const testHarness = harness(fetchImpl);
    const output = await executeLookUpPlaceLocationTool(
      { place: "Houston", place_choice_id: "place-osm-expired" },
      toolOptions(),
      testHarness.dependencies
    );

    expect(output).toMatchObject({
      status: "needs_place_choice",
      choices: [
        { choice_id: "place-osm-new-a" },
        { choice_id: "place-osm-new-b" },
      ],
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
    });
    expect("message" in output ? output.message : "").toContain(
      "earlier choice is no longer available"
    );
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).toHaveBeenCalledWith({
      ...output,
      query: "Houston",
    });
  });

  it("honors a previously offered choice after bounded results reorder it below the display cap", async () => {
    const firstOrder = [
      { id: "osm-a", label: "Alpha", lon: -90, lat: 30 },
      { id: "osm-b", label: "Bravo", lon: -91, lat: 31 },
      { id: "osm-c", label: "Charlie", lon: -92, lat: 32 },
      { id: "osm-d", label: "Delta", lon: -93, lat: 33 },
      { id: "osm-e", label: "Echo", lon: -94, lat: 34 },
    ];
    const secondOrder = [
      firstOrder[3],
      firstOrder[4],
      firstOrder[0],
      firstOrder[1],
      firstOrder[2],
    ];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(geocodeResponse(firstOrder))
      .mockResolvedValueOnce(geocodeResponse(secondOrder));
    const testHarness = harness(fetchImpl);

    const initial = await executeLookUpPlaceLocationTool(
      { place: "Example" },
      toolOptions(),
      testHarness.dependencies
    );
    expect(initial.status).toBe("needs_place_choice");
    if (initial.status !== "needs_place_choice" || !initial.choices) {
      throw new Error("expected bounded place choices");
    }
    expect(initial.choices).toHaveLength(5);
    const selectedId = initial.choices[2].choice_id;

    await expect(executeLookUpPlaceLocationTool(
      { place: "Example", place_choice_id: selectedId },
      toolOptions(),
      testHarness.dependencies
    )).resolves.toMatchObject({
      status: "success",
      canonical_label: "Charlie",
    });
  });

  it("preserves the explicit rate-limit state without inferring a location", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const testHarness = harness(fetchImpl);

    const output = await executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(),
      testHarness.dependencies
    );
    expect(output).toEqual({
      status: "place_lookup_failed",
      reason: "rate_limited",
      message: "There were too many place searches at once. Wait a moment and try again. Your current map and results are unchanged.",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
    });
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).toHaveBeenCalledWith({
      ...output,
      query: "Houston",
    });
  });

  it.each([
    [{ place: "H" }, "Enter a place name between 2 and 200 characters."],
    [{ place: "Houston\u0000" }, "Enter a place name between 2 and 200 characters."],
    [{ place: "Houston", place_choice_id: "place-!" }, "Search for the place again, then choose one of the new options."],
    [{ place: "Houston", extra: true }, "extra information it does not recognize"],
  ])("rejects invalid input without contacting the geocoder %#", async (input, message) => {
    const fetchImpl = vi.fn();
    const testHarness = harness(fetchImpl);

    const output = await executeLookUpPlaceLocationTool(
      input,
      toolOptions(),
      testHarness.dependencies
    );

    expect(output).toMatchObject({
      status: "invalid_input",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
    });
    expect("message" in output ? output.message : "").toContain(message);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).toHaveBeenCalledWith({
      ...output,
      query: "place" in input && typeof input.place === "string"
        ? input.place.trim()
        : null,
    });
  });

  it("lets only the latest overlapping lookup update the map or visible feedback", async () => {
    const pendingFetches = new Map<string, (response: Response) => void>();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)) as { query: string };
      return new Promise<Response>((resolve) => {
        pendingFetches.set(query.query, resolve);
      });
    });
    const testHarness = harness(fetchImpl);

    const older = executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(),
      testHarness.dependencies
    );
    await vi.waitFor(() => expect(pendingFetches.has("Houston")).toBe(true));
    const newer = executeLookUpPlaceLocationTool(
      { place: "Chicago" },
      toolOptions(),
      testHarness.dependencies
    );
    await vi.waitFor(() => expect(pendingFetches.has("Chicago")).toBe(true));

    pendingFetches.get("Chicago")?.(geocodeResponse([{
      id: "osm-chicago",
      label: "Chicago, Illinois, United States",
      lon: -87.6298,
      lat: 41.8781,
    }]));
    await expect(newer).resolves.toMatchObject({
      status: "success",
      canonical_label: "Chicago, Illinois, United States",
    });

    pendingFetches.get("Houston")?.(geocodeResponse([{
      id: "osm-houston",
      label: "Houston, Texas, United States",
      lon: -95.3698,
      lat: 29.7604,
    }]));
    await expect(older).resolves.toMatchObject({
      status: "superseded",
      ui_updated: false,
      map_updated: false,
    });

    expect(testHarness.applyUpdate).toHaveBeenCalledOnce();
    expect(testHarness.applyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      selection: expect.objectContaining({
        label: "Chicago, Illinois, United States (place search result)",
      }),
      layers: {},
      origin: "agent",
    }));
    expect(testHarness.publishFeedback).toHaveBeenCalledOnce();
    expect(testHarness.publishFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", query: "Chicago" })
    );
  });

  it.each([
    {
      caseName: "a unique result",
      response: geocodeResponse([{
        id: "osm-houston",
        label: "Houston, Texas, United States",
        lon: -95.3698,
        lat: 29.7604,
      }]),
      expectedStatus: "success",
      appliesPlace: true,
    },
    {
      caseName: "an ambiguous result",
      response: geocodeResponse([
        { id: "osm-springfield-il", label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
        { id: "osm-springfield-mo", label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
      ]),
      expectedStatus: "needs_place_choice",
      appliesPlace: false,
    },
    {
      caseName: "a failed result",
      response: geocodeResponse([], 429),
      expectedStatus: "place_lookup_failed",
      appliesPlace: false,
    },
  ])("keeps $caseName visible when only map layers change during lookup", async ({
    response,
    expectedStatus,
    appliesPlace,
  }) => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const testHarness = harness(fetchImpl);
    const pending = executeLookUpPlaceLocationTool(
      { place: expectedStatus === "needs_place_choice" ? "Springfield" : "Houston" },
      toolOptions(),
      testHarness.dependencies
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    const beforeLayerChange = testHarness.readSnapshot().mapState;
    const afterLayerChange = applyEnvironmentalMapDesiredState(
      beforeLayerChange,
      { rain_satellite: true },
      {
        date: beforeLayerChange.date,
        contextChanged: false,
        origin: "agent",
        now: NOW,
      }
    );
    expect(afterLayerChange.revision).toBeGreaterThan(beforeLayerChange.revision);
    expect(afterLayerChange.agentFocusRevision).toBeGreaterThan(
      beforeLayerChange.agentFocusRevision
    );
    expect(afterLayerChange.placeFocusRevision).toBe(
      beforeLayerChange.placeFocusRevision
    );
    expect(afterLayerChange.contextRevision).toBe(beforeLayerChange.contextRevision);
    testHarness.replaceMapState(afterLayerChange);

    resolveFetch?.(response);
    await expect(pending).resolves.toMatchObject({
      status: expectedStatus,
      ui_updated: true,
    });
    expect(testHarness.publishFeedback).toHaveBeenCalledOnce();
    expect(testHarness.readSnapshot().mapState.layers.rain_satellite.visible).toBe(true);
    if (appliesPlace) {
      expect(testHarness.applyUpdate).toHaveBeenCalledOnce();
      expect(testHarness.readSnapshot().mapState.placeFocusRevision).toBe(
        beforeLayerChange.placeFocusRevision + 1
      );
    } else {
      expect(testHarness.applyUpdate).not.toHaveBeenCalled();
      expect(testHarness.readSnapshot().mapState.placeFocusRevision).toBe(
        beforeLayerChange.placeFocusRevision
      );
    }
  });

  it("honors cancellation before any open-world request", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const fetchImpl = vi.fn();
    const testHarness = harness(fetchImpl);

    await expect(executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(controller.signal),
      testHarness.dependencies
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).not.toHaveBeenCalled();
  });

  it("honors cancellation after a non-conforming fetch resolves", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const controller = new AbortController();
    const testHarness = harness(fetchImpl);
    const pending = executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(controller.signal),
      testHarness.dependencies
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("cancelled", "AbortError"));
    resolveFetch?.(geocodeResponse([
      { id: "osm-houston", label: "Houston", lon: -95.36, lat: 29.76 },
    ]));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).not.toHaveBeenCalled();
  });

  it("honors cancellation while the response body is being parsed", async () => {
    let resolveJson: ((value: unknown) => void) | undefined;
    const response = {
      ok: true,
      status: 200,
      json: vi.fn(() => new Promise<unknown>((resolve) => {
        resolveJson = resolve;
      })),
    } as unknown as Response;
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => response);
    const testHarness = harness(fetchImpl);
    const pending = executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(controller.signal),
      testHarness.dependencies
    );
    await vi.waitFor(() => expect(response.json).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("cancelled", "AbortError"));
    resolveJson?.({
      ok: true,
      results: [
        { id: "osm-houston", label: "Houston", lon: -95.36, lat: 29.76 },
      ],
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(testHarness.applyUpdate).not.toHaveBeenCalled();
    expect(testHarness.publishFeedback).not.toHaveBeenCalled();
  });
});
