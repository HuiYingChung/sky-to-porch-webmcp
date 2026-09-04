/// <reference types="webmcp-types" />

import { describe, expect, it, vi } from "vitest";
import {
  LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA,
  LOOK_UP_PLACE_LOCATION_TOOL_NAME,
  createLookUpPlaceLocationTool,
  executeLookUpPlaceLocationTool,
} from "@/lib/webmcp/place-tool";
import { PLACE_CHOICE_ID_RE } from "@/lib/webmcp/place-resolution";

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

describe("look_up_place_location WebMCP tool", () => {
  it("publishes a fixed, read-only, idempotent lookup contract", () => {
    const tool = createLookUpPlaceLocationTool({ fetchImpl: vi.fn() });

    expect(LOOK_UP_PLACE_LOCATION_TOOL_NAME).toBe("look_up_place_location");
    expect(tool.name).toBe(LOOK_UP_PLACE_LOCATION_TOOL_NAME);
    expect(tool.inputSchema).toBe(LOOK_UP_PLACE_LOCATION_INPUT_SCHEMA);
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
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

  it("returns only normalized Photon/OSM geography, including bounds and supplied admin context", async () => {
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

    const output = await executeLookUpPlaceLocationTool(
      { place: "  Houston  " },
      toolOptions(),
      { fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledWith("/api/geocode", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ query: "Houston" }),
    }));
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
      ui_updated: false,
    });
  });

  it("pauses for the person when the place is ambiguous and exposes stable choice ids", async () => {
    const fetchImpl = vi.fn(async () => geocodeResponse([
      { id: "osm-city", label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
      { id: "osm-town", label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
    ]));

    const output = await executeLookUpPlaceLocationTool(
      { place: "Springfield", place_choice_id: null },
      toolOptions(),
      { fetchImpl }
    );

    expect(output).toMatchObject({
      status: "needs_place_choice",
      ui_updated: false,
      choices: [
        { choice_id: "place-osm-city", label: "Springfield, Illinois" },
        { choice_id: "place-osm-town", label: "Springfield, Missouri" },
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
    expect("message" in output ? output.message : "").toContain("PAUSE FOR USER:");
  });

  it("distinguishes same-coordinate candidates and continues with the selected fallback id", async () => {
    const candidates = [
      { label: "Washington County, Alabama", lon: -88.206, lat: 31.409 },
      { label: "Washington County, Mississippi", lon: -88.206, lat: 31.409 },
    ];
    const fetchImpl = vi.fn(async () => geocodeResponse(candidates));

    const ambiguous = await executeLookUpPlaceLocationTool(
      { place: "Washington County" },
      toolOptions(),
      { fetchImpl }
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
      { fetchImpl }
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

    const output = await executeLookUpPlaceLocationTool(
      { place: "Springfield" },
      toolOptions(),
      { fetchImpl }
    );
    expect(output).toEqual({
      status: "place_lookup_failed",
      message: "Place search was unavailable; no location was inferred.",
      ui_updated: false,
    });
  });

  it.each([
    { ok: true },
    { ok: true, results: {} },
  ])("treats malformed successful geocoder envelope %# as a source failure", async (payload) => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify(payload),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));

    await expect(executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(),
      { fetchImpl }
    )).resolves.toEqual({
      status: "place_lookup_failed",
      message: "Place search was unavailable; no location was inferred.",
      ui_updated: false,
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

    const output = await executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(),
      { fetchImpl }
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

    const output = await executeLookUpPlaceLocationTool(
      { place: "Springfield" },
      toolOptions(),
      { fetchImpl }
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

    const output = await executeLookUpPlaceLocationTool(
      { place: "Houston", place_choice_id: "place-osm-expired" },
      toolOptions(),
      { fetchImpl }
    );

    expect(output).toMatchObject({
      status: "needs_place_choice",
      choices: [
        { choice_id: "place-osm-new-a" },
        { choice_id: "place-osm-new-b" },
      ],
      ui_updated: false,
    });
    expect("message" in output ? output.message : "").toContain(
      "previous place choice is stale"
    );
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

    const initial = await executeLookUpPlaceLocationTool(
      { place: "Example" },
      toolOptions(),
      { fetchImpl }
    );
    expect(initial.status).toBe("needs_place_choice");
    if (initial.status !== "needs_place_choice" || !initial.choices) {
      throw new Error("expected bounded place choices");
    }
    expect(initial.choices).toHaveLength(3);
    const selectedId = initial.choices[2].choice_id;

    await expect(executeLookUpPlaceLocationTool(
      { place: "Example", place_choice_id: selectedId },
      toolOptions(),
      { fetchImpl }
    )).resolves.toMatchObject({
      status: "success",
      canonical_label: "Charlie",
    });
  });

  it("preserves the explicit rate-limit state without inferring a location", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));

    await expect(executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(),
      { fetchImpl }
    )).resolves.toEqual({
      status: "place_lookup_failed",
      reason: "rate_limited",
      message: "Place search was rate-limited; wait briefly before retrying.",
      ui_updated: false,
    });
  });

  it.each([
    [{ place: "H" }, "place must be 2–200"],
    [{ place: "Houston\u0000" }, "place must be 2–200"],
    [{ place: "Houston", place_choice_id: "place-!" }, "copied unchanged"],
    [{ place: "Houston", extra: true }, "Only place and place_choice_id"],
  ])("rejects invalid input without contacting the geocoder %#", async (input, message) => {
    const fetchImpl = vi.fn();

    const output = await executeLookUpPlaceLocationTool(
      input,
      toolOptions(),
      { fetchImpl }
    );

    expect(output).toMatchObject({ status: "invalid_input", ui_updated: false });
    expect("message" in output ? output.message : "").toContain(message);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors cancellation before any open-world request", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const fetchImpl = vi.fn();

    await expect(executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(controller.signal),
      { fetchImpl }
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors cancellation after a non-conforming fetch resolves", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const controller = new AbortController();
    const pending = executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(controller.signal),
      { fetchImpl }
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("cancelled", "AbortError"));
    resolveFetch?.(geocodeResponse([
      { id: "osm-houston", label: "Houston", lon: -95.36, lat: 29.76 },
    ]));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
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
    const pending = executeLookUpPlaceLocationTool(
      { place: "Houston" },
      toolOptions(controller.signal),
      { fetchImpl: vi.fn(async () => response) }
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
  });
});
