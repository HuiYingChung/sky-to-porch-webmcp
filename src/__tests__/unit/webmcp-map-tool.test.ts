/// <reference types="webmcp-types" />

import { describe, expect, it, vi } from "vitest";
import { createAgentPlaceLookupFeedbackCoordinator } from "@/components/webmcp/webmcp-bridge";
import {
  SET_ENVIRONMENTAL_MAP_LAYERS_INPUT_SCHEMA,
  SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME,
  createSetEnvironmentalMapLayersTool,
  executeSetEnvironmentalMapLayersTool,
  type EnvironmentalMapToolSnapshot,
  type SetEnvironmentalMapLayersDependencies,
} from "@/lib/webmcp/map-tool";
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
import type { AgentPlaceLookupReceiptPayload } from "@/lib/webmcp/place-tool";

const NOW = new Date("2026-08-26T18:00:00.000Z");
const PUBLIC_INVALID_MAP_MESSAGE =
  "We couldn’t use this map request. Check the place, date, area size, and map choices, then try again.";

function toolOptions(
  signal = new AbortController().signal
): WebMCP.ToolExecuteCallbackOptions {
  return { signal };
}

function selection(
  start = "2026-08-25T00:00:00Z",
  end = "2026-08-25T23:59:59Z"
): PlaceSelection {
  return buildGeocodedPlaceSelection(
    "Houston, Texas",
    { lon: -95.36, lat: 29.76 },
    25,
    "custom",
    start,
    end,
    { west: -95.9, south: 29.5, east: -95, north: 30.1 }
  );
}

function stateWithDate(date = "2026-08-25"): EnvironmentalMapState {
  return { ...createInitialEnvironmentalMapState(), date };
}

function harness(
  placeSelection: PlaceSelection | null,
  mapState: EnvironmentalMapState = stateWithDate()
) {
  let snapshot: EnvironmentalMapToolSnapshot = { placeSelection, mapState };
  const applyUpdate: SetEnvironmentalMapLayersDependencies["applyUpdate"] = vi.fn(
    (update) => {
      const contextChanged = !sameMapSelection(snapshot.placeSelection, update.selection) ||
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
    }
  );
  return {
    dependencies: {
      readState: () => snapshot,
      applyUpdate,
      now: () => NOW,
    } satisfies SetEnvironmentalMapLayersDependencies,
    applyUpdate,
    readSnapshot: () => snapshot,
  };
}

describe("set_environmental_map_layers WebMCP tool", () => {
  it("publishes a fixed, idempotent desired-state contract", () => {
    const { dependencies } = harness(selection());
    const tool = createSetEnvironmentalMapLayersTool(dependencies);

    expect(SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME).toBe(
      "set_environmental_map_layers"
    );
    expect(tool.name).toBe(SET_ENVIRONMENTAL_MAP_LAYERS_TOOL_NAME);
    expect(tool.inputSchema).toBe(SET_ENVIRONMENTAL_MAP_LAYERS_INPUT_SCHEMA);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: true,
    });
    expect(SET_ENVIRONMENTAL_MAP_LAYERS_INPUT_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["layers"],
      properties: {
        layers: { type: "object", additionalProperties: false, minProperties: 1 },
        date: { type: ["string", "null"] },
        radius_km: { type: ["number", "null"], minimum: 1, maximum: 250 },
      },
    });
    expect(Object.keys(
      SET_ENVIRONMENTAL_MAP_LAYERS_INPUT_SCHEMA.properties.layers.properties
    )).toEqual([
      "rain_satellite",
      "surface_heat_satellite",
      "thermal_anomalies_firms",
      "flood_extent",
    ]);
  });

  it("keeps map revisions and internal layer codes behind the public factory boundary", async () => {
    const { dependencies } = harness(selection());
    const tool = createSetEnvironmentalMapLayersTool(dependencies);

    const output = await tool.execute(
      { layers: { rain_satellite: true } },
      toolOptions()
    ) as Record<string, unknown>;

    expect(output).toMatchObject({
      status: "success",
      status_label: "Map updated",
      layers: expect.arrayContaining([
        expect.objectContaining({
          layer_name: "Rainfall imagery",
          status_label: "Loading",
          source_name: "NASA GIBS IMERG Precipitation Rate Visualization",
        }),
      ]),
    });
    expect(output).not.toHaveProperty("map_state_revision");
    const publicLayers = output.layers as Array<Record<string, unknown>>;
    expect(publicLayers).toHaveLength(4);
    for (const layer of publicLayers) {
      expect(layer).not.toHaveProperty("status");
      expect(layer).not.toHaveProperty("source");
    }
    expect(JSON.stringify(output)).not.toMatch(
      /rain_satellite|surface_heat_satellite|thermal_anomalies_firms|flood_extent/u
    );
  });

  it("applies a partial patch, preserves omitted layers, and makes retries idempotent", async () => {
    const current = applyEnvironmentalMapDesiredState(
      stateWithDate(),
      { surface_heat_satellite: true },
      { date: "2026-08-25", contextChanged: false, origin: "human", now: NOW }
    );
    const { dependencies, readSnapshot } = harness(selection(), current);

    const first = await executeSetEnvironmentalMapLayersTool(
      { layers: { rain_satellite: true } },
      toolOptions(),
      dependencies
    );
    const retry = await executeSetEnvironmentalMapLayersTool(
      { layers: { rain_satellite: true } },
      toolOptions(),
      dependencies
    );

    expect(first).toMatchObject({
      status: "success",
      status_label: "Map updated",
      display_summary: expect.stringContaining("Environmental map updated"),
      ui_updated: true,
      analysis_cleared: false,
      layers: {
        rain_satellite: {
          layer_name: "Rainfall imagery",
          requested: true,
          visible: false,
          status: "loading",
          status_label: "Loading",
          source_name: "NASA GIBS IMERG Precipitation Rate Visualization",
        },
        surface_heat_satellite: { requested: true, visible: false, status: "loading" },
        thermal_anomalies_firms: { requested: false, status: "hidden" },
        flood_extent: { requested: false, status: "hidden" },
      },
    });
    expect(retry).toMatchObject({
      status: "success",
      map_state_revision: first.status === "success" ? first.map_state_revision : -1,
    });
    expect(readSnapshot().mapState.agentFocusRevision).toBe(2);
  });

  it("refuses to show a layer without either a current or requested place", async () => {
    const { dependencies, applyUpdate } = harness(null, createInitialEnvironmentalMapState());

    const output = await executeSetEnvironmentalMapLayersTool(
      { layers: { rain_satellite: true } },
      toolOptions(),
      dependencies
    );

    expect(output).toMatchObject({ status: "invalid_input", ui_updated: false });
    expect("message" in output ? output.message : "").toBe(
      PUBLIC_INVALID_MAP_MESSAGE
    );
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("does not silently collapse a multi-day selection and accepts an explicit date", async () => {
    const ranged = selection(
      "2026-08-23T00:00:00Z",
      "2026-08-25T23:59:59Z"
    );
    const { dependencies, applyUpdate } = harness(
      ranged,
      createInitialEnvironmentalMapState()
    );

    const rejected = await executeSetEnvironmentalMapLayersTool(
      { layers: { flood_extent: true } },
      toolOptions(),
      dependencies
    );
    expect(rejected).toMatchObject({ status: "invalid_input", ui_updated: false });
    expect("message" in rejected ? rejected.message : "").toBe(
      PUBLIC_INVALID_MAP_MESSAGE
    );
    expect(applyUpdate).not.toHaveBeenCalled();

    const accepted = await executeSetEnvironmentalMapLayersTool(
      { layers: { flood_extent: true }, date: "2026-08-24" },
      toolOptions(),
      dependencies
    );
    expect(accepted).toMatchObject({
      status: "success",
      map_date: "2026-08-24",
      analysis_cleared: true,
    });
  });

  it("keeps the exact current selection for a pure layer toggle", async () => {
    const currentSelection = selection();
    const { dependencies, applyUpdate } = harness(currentSelection);

    await executeSetEnvironmentalMapLayersTool(
      { layers: { surface_heat_satellite: true } },
      toolOptions(),
      dependencies
    );

    expect(applyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      selection: currentSelection,
      date: "2026-08-25",
      layers: { surface_heat_satellite: true },
      origin: "agent",
    }));
  });

  it("updates place, date, radius, and propagates source place bounds", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [{
        id: "osm-r-2688911",
        label: "Houston, Texas, United States",
        lon: -95.3676974,
        lat: 29.7589382,
        boundingBox: { west: -95.9, south: 29.5, east: -95, north: 30.1 },
        adminContext: { city: "Houston", state: "Texas" },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const { dependencies, applyUpdate } = harness(null, createInitialEnvironmentalMapState());

    const output = await executeSetEnvironmentalMapLayersTool(
      {
        layers: { rain_satellite: true, surface_heat_satellite: true },
        place: "Houston",
        date: "2026-08-25",
        radius_km: 40,
      },
      toolOptions(),
      { ...dependencies, fetchImpl }
    );

    expect(output).toMatchObject({
      status: "success",
      ui_updated: true,
      analysis_cleared: true,
      selected_place: {
        label: "Houston, Texas, United States (place search result)",
        longitude: -95.3676974,
        latitude: 29.7589382,
        radius_km: 40,
        bounding_box: { west: -95.9, south: 29.5, east: -95, north: 30.1 },
      },
      map_date: "2026-08-25",
    });
    const update = vi.mocked(applyUpdate).mock.calls[0][0];
    expect(update.selection).toMatchObject({
      selectionMethod: "place_search",
      placeBoundingBox: { west: -95.9, south: 29.5, east: -95, north: 30.1 },
      analysisArea: { radiusKm: 40 },
      timeSelection: {
        type: "custom",
        startTs: "2026-08-25T00:00:00.000Z",
        endTs: "2026-08-25T23:59:59.000Z",
      },
    });
  });

  it("reports an older FIRMS date as requested but not visible or fetched", async () => {
    const { dependencies } = harness(selection(), stateWithDate("2026-08-24"));

    const output = await executeSetEnvironmentalMapLayersTool(
      { layers: { thermal_anomalies_firms: true } },
      toolOptions(),
      dependencies
    );

    expect(output).toMatchObject({
      status: "success",
      map_date: "2026-08-24",
      layers: {
        thermal_anomalies_firms: {
          requested: true,
          visible: false,
          status: "unsupported_date",
          date: "2026-08-24",
          visualization_only: true,
          source: "NASA FIRMS Active Fire Data",
        },
      },
    });
    expect(output.status === "success"
      ? output.layers.thermal_anomalies_firms.limitation
      : "").toContain("not fire perimeters");
  });

  it("keeps source status distinct from effective visibility in every layer output", async () => {
    const returnedState: EnvironmentalMapState = {
      date: "2026-08-25",
      revision: 9,
      contextRevision: 3,
      agentFocusRevision: 4,
      placeFocusRevision: 0,
      layers: {
        rain_satellite: { visible: true, status: "ready" },
        surface_heat_satellite: { visible: true, status: "no_imagery" },
        thermal_anomalies_firms: { visible: true, status: "source_failure" },
        flood_extent: { visible: false, status: "hidden" },
      },
    };
    const currentSelection = selection();
    const applyUpdate = vi.fn(() => ({
      mapState: returnedState,
      analysisCleared: false,
    }));

    const output = await executeSetEnvironmentalMapLayersTool(
      { layers: { rain_satellite: false } },
      toolOptions(),
      {
        readState: () => ({ placeSelection: currentSelection, mapState: stateWithDate() }),
        applyUpdate,
        now: () => NOW,
      }
    );

    expect(output).toMatchObject({
      status: "success",
      map_state_revision: 9,
      layers: {
        rain_satellite: {
          requested: true,
          visible: true,
          status: "ready",
          source: "NASA GIBS IMERG Precipitation Rate Visualization",
          visualization_only: true,
        },
        surface_heat_satellite: {
          requested: true,
          visible: false,
          status: "no_imagery",
        },
        thermal_anomalies_firms: {
          requested: true,
          visible: false,
          status: "source_failure",
        },
        flood_extent: {
          requested: false,
          visible: false,
          status: "hidden",
        },
      },
    });
    expect(output.status === "success" ? output.boundary : "").toContain(
      "Source failure, zero detections, no rendered observation, or a no-visible-pixels check is not evidence of no hazard"
    );
    expect(output.status === "success"
      ? output.layers.surface_heat_satellite.status_detail
      : "").toContain("cannot distinguish a valid fully transparent image");
  });

  it("describes each no-observation state according to its actual source", async () => {
    const noObservationState: EnvironmentalMapState = {
      date: "2026-08-25",
      revision: 12,
      contextRevision: 4,
      agentFocusRevision: 2,
      placeFocusRevision: 0,
      layers: {
        rain_satellite: { visible: true, status: "no_imagery" },
        surface_heat_satellite: { visible: true, status: "no_imagery" },
        thermal_anomalies_firms: { visible: true, status: "no_imagery" },
        flood_extent: { visible: true, status: "no_imagery" },
      },
    };
    const output = await executeSetEnvironmentalMapLayersTool(
      { layers: { rain_satellite: true } },
      toolOptions(),
      {
        readState: () => ({ placeSelection: selection(), mapState: stateWithDate() }),
        applyUpdate: () => ({ mapState: noObservationState, analysisCleared: false }),
        now: () => NOW,
      }
    );

    expect(output.status).toBe("success");
    if (output.status !== "success") throw new Error("expected success");
    expect(output.layers.rain_satellite.status_detail).toContain(
      "NASA GIBS check found no visible pixels"
    );
    expect(output.layers.thermal_anomalies_firms.status_detail).toContain(
      "zero qualifying thermal-anomaly detections"
    );
    expect(output.layers.flood_extent.status_detail).toContain(
      "no rendered observation"
    );
    const displayText = Object.values(output.layers)
      .flatMap((layer) => [layer.layer_name, layer.source_name, layer.status_detail])
      .join(" ");
    expect(displayText).not.toMatch(/\b(?:nasa_gibs|thermal_anomalies_firms|flood_extent)\b/u);
  });

  it("pauses for an ambiguous place and preserves every map argument on retry", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [
        { id: "osm-a", label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
        { id: "osm-b", label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
      ],
    }), { headers: { "Content-Type": "application/json" } }));
    const { dependencies, applyUpdate } = harness(
      null,
      createInitialEnvironmentalMapState()
    );
    const original = {
      layers: { rain_satellite: true, flood_extent: false },
      place: "Springfield",
      date: "2026-08-25",
      radius_km: 40,
    };

    const paused = await executeSetEnvironmentalMapLayersTool(
      original,
      toolOptions(),
      { ...dependencies, fetchImpl }
    );
    expect(paused).toMatchObject({
      status: "needs_place_choice",
      ui_updated: false,
      requires_user_input: true,
      must_not_retry_before_user_reply: true,
      after_user_choice: {
        continue_task: true,
        retry_with_original_arguments: original,
      },
    });
    expect(applyUpdate).not.toHaveBeenCalled();
    if (paused.status !== "needs_place_choice" || !paused.choices) {
      throw new Error("expected place choices");
    }

    const completed = await executeSetEnvironmentalMapLayersTool(
      { ...original, place_choice_id: paused.choices[1].choice_id },
      toolOptions(),
      { ...dependencies, fetchImpl }
    );
    expect(completed).toMatchObject({
      status: "success",
      selected_place: {
        label: "Springfield, Missouri (place search result)",
        radius_km: 40,
      },
      map_date: "2026-08-25",
      layers: {
        rain_satellite: { requested: true },
        flood_extent: { requested: false },
      },
    });
    expect(vi.mocked(applyUpdate).mock.calls[0][0]).toMatchObject({
      date: "2026-08-25",
      layers: original.layers,
      selection: {
        coordinate: { lon: -93.29, lat: 37.21 },
        analysisArea: { radiusKm: 40 },
      },
    });
  });

  it("returns all five checked candidates for an ambiguous map place", async () => {
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      id: `springfield-${index}`,
      label: `Springfield ${index + 1}`,
      lon: -90 - index,
      lat: 35 + index,
    }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: candidates,
    }), { headers: { "Content-Type": "application/json" } }));
    const { dependencies, applyUpdate } = harness(
      null,
      createInitialEnvironmentalMapState()
    );

    const output = await executeSetEnvironmentalMapLayersTool(
      {
        layers: { rain_satellite: true },
        place: "Springfield",
        date: "2026-08-25",
      },
      toolOptions(),
      { ...dependencies, fetchImpl }
    );

    expect(output.status).toBe("needs_place_choice");
    expect("choices" in output ? output.choices : []).toHaveLength(5);
    expect("choices" in output ? output.choices?.at(-1)?.label : undefined)
      .toBe("Springfield 5");
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("refreshes a stale place choice without losing retry arguments", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [
        { id: "osm-a", label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
        { id: "osm-b", label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
      ],
    }), { headers: { "Content-Type": "application/json" } }));
    const { dependencies, applyUpdate } = harness(null, createInitialEnvironmentalMapState());
    const output = await executeSetEnvironmentalMapLayersTool(
      {
        layers: { surface_heat_satellite: true },
        place: "Springfield",
        place_choice_id: "place-stale-id",
        date: "2026-08-25",
        radius_km: 12,
      },
      toolOptions(),
      { ...dependencies, fetchImpl }
    );
    expect(output).toMatchObject({
      status: "needs_place_choice",
      message: expect.stringContaining("earlier choice is no longer available"),
      after_user_choice: {
        retry_with_original_arguments: {
          layers: { surface_heat_satellite: true },
          place: "Springfield",
          date: "2026-08-25",
          radius_km: 12,
        },
      },
    });
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it.each([
    { layers: {} },
    { layers: { unknown: true } },
    { layers: { rain_satellite: "yes" } },
    { layers: { rain_satellite: true }, date: "2026-02-29" },
    { layers: { rain_satellite: true }, date: "2026-08-27" },
    { layers: { rain_satellite: true }, radius_km: 0 },
    { layers: { rain_satellite: true }, place_choice_id: "place-valid" },
    { layers: { rain_satellite: true }, extra: true },
  ])("rejects invalid input before updating state %#", async (input) => {
    const { dependencies, applyUpdate } = harness(selection());

    const output = await executeSetEnvironmentalMapLayersTool(
      input,
      toolOptions(),
      dependencies
    );

    expect(output).toMatchObject({ status: "invalid_input", ui_updated: false });
    expect("message" in output ? output.message : "").toBe(
      PUBLIC_INVALID_MAP_MESSAGE
    );
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("does not expose an unexpected geocoder error in the map result or visible feedback", async () => {
    const privateError =
      "C:\\services\\private-geocoder.ts 123e4567-e89b-12d3-a456-426614174000 deadbeefcafebabe";
    const fetchImpl = vi.fn(async () => {
      throw new Error(privateError);
    });
    const { dependencies, applyUpdate } = harness(
      null,
      createInitialEnvironmentalMapState()
    );
    const receipts: AgentPlaceLookupReceiptPayload[] = [];
    const beginPlaceLookupFeedback = createAgentPlaceLookupFeedbackCoordinator(
      async (receipt) => {
        receipts.push(receipt);
      }
    );
    const tool = createSetEnvironmentalMapLayersTool({
      ...dependencies,
      fetchImpl,
      beginPlaceLookupFeedback,
    });

    const output = await tool.execute(
      { layers: { rain_satellite: true }, place: "Houston" },
      toolOptions()
    );

    expect(output).toMatchObject({
      status: "place_lookup_failed",
      message: "Place search was unavailable; the map was not changed.",
      ui_updated: false,
    });
    expect(receipts.map((receipt) => receipt.status)).toEqual([
      "lookup_pending",
      "place_lookup_failed",
    ]);
    expect(receipts.at(-1)).toMatchObject({
      status: "place_lookup_failed",
      query: "Houston",
      operation: "map",
    });
    for (const exposedValue of [output, receipts.at(-1)]) {
      const publicText = JSON.stringify(exposedValue);
      expect(publicText).not.toContain("private-geocoder.ts");
      expect(publicText).not.toContain("123e4567-e89b-12d3-a456-426614174000");
      expect(publicText).not.toContain("deadbeefcafebabe");
    }
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("honors cancellation before reading or mutating shared state", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const readState = vi.fn();
    const applyUpdate = vi.fn();

    await expect(executeSetEnvironmentalMapLayersTool(
      { layers: { rain_satellite: true } },
      toolOptions(controller.signal),
      { readState, applyUpdate, now: () => NOW }
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(readState).not.toHaveBeenCalled();
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("honors cancellation that arrives while place lookup is pending", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const controller = new AbortController();
    const { dependencies, applyUpdate } = harness(null, createInitialEnvironmentalMapState());
    const pending = executeSetEnvironmentalMapLayersTool(
      { layers: { rain_satellite: true }, place: "Houston" },
      toolOptions(controller.signal),
      { ...dependencies, fetchImpl }
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("cancelled", "AbortError"));
    resolveFetch?.(new Response(JSON.stringify({
      ok: true,
      results: [{ id: "osm-houston", label: "Houston", lon: -95.36, lat: 29.76 }],
    }), { headers: { "Content-Type": "application/json" } }));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("lets a newer layer-only request supersede a pending map lookup without claiming an analysis mutation", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const { dependencies, applyUpdate } = harness(
      null,
      createInitialEnvironmentalMapState()
    );
    const beginContextMutationInvocation = vi.fn(() => () => true);
    const tool = createSetEnvironmentalMapLayersTool({
      ...dependencies,
      fetchImpl,
      beginContextMutationInvocation,
    });
    const older = tool.execute(
      { layers: { rain_satellite: true }, place: "Houston" },
      toolOptions()
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const newer = await tool.execute(
      { layers: { rain_satellite: false } },
      toolOptions()
    );
    expect(newer).toMatchObject({ status: "success" });
    expect(newer).not.toHaveProperty("map_state_revision");
    resolveFetch?.(new Response(JSON.stringify({
      ok: true,
      results: [{ id: "osm-houston", label: "Houston", lon: -95.36, lat: 29.76 }],
    }), { headers: { "Content-Type": "application/json" } }));

    await expect(older).resolves.toMatchObject({ status: "superseded", ui_updated: false });
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(beginContextMutationInvocation).not.toHaveBeenCalled();
  });

  it("lets an invalid newer map request supersede an older pending lookup", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const { dependencies, applyUpdate } = harness(
      null,
      createInitialEnvironmentalMapState()
    );
    let latestContextInvocation = 0;
    const beginContextInvocation = vi.fn(() => {
      const invocation = ++latestContextInvocation;
      return () => invocation === latestContextInvocation;
    });
    const tool = createSetEnvironmentalMapLayersTool({
      ...dependencies,
      fetchImpl,
      beginContextInvocation,
    });

    const older = tool.execute(
      { layers: { rain_satellite: true }, place: "Houston" },
      toolOptions()
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await expect(tool.execute(
      { layers: {} },
      toolOptions()
    )).resolves.toMatchObject({ status: "invalid_input", ui_updated: false });

    resolveFetch?.(new Response(JSON.stringify({
      ok: true,
      results: [{ id: "osm-houston", label: "Houston", lon: -95.36, lat: 29.76 }],
    }), { headers: { "Content-Type": "application/json" } }));
    await expect(older).resolves.toMatchObject({ status: "superseded", ui_updated: false });
    expect(beginContextInvocation).toHaveBeenCalledTimes(2);
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("reserves invocation order before lookup so an older result cannot beat a newer request", async () => {
    const pendingByPlace = new Map<
      string,
      (response: Response) => void
    >();
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      return new Promise<Response>((resolve) => {
        pendingByPlace.set(body.query, resolve);
      });
    });
    const { dependencies, applyUpdate } = harness(
      null,
      createInitialEnvironmentalMapState()
    );
    const tool = createSetEnvironmentalMapLayersTool({
      ...dependencies,
      fetchImpl,
    });

    const older = tool.execute(
      { layers: { rain_satellite: true }, place: "Austin" },
      toolOptions()
    );
    await vi.waitFor(() => expect(pendingByPlace.has("Austin")).toBe(true));
    const newer = tool.execute(
      { layers: { surface_heat_satellite: true }, place: "Dallas" },
      toolOptions()
    );
    await vi.waitFor(() => expect(pendingByPlace.has("Dallas")).toBe(true));

    pendingByPlace.get("Austin")?.(new Response(JSON.stringify({
      ok: true,
      results: [{ id: "osm-austin", label: "Austin", lon: -97.74, lat: 30.27 }],
    }), { headers: { "Content-Type": "application/json" } }));
    await expect(older).resolves.toMatchObject({
      status: "superseded",
      ui_updated: false,
    });
    expect(applyUpdate).not.toHaveBeenCalled();

    pendingByPlace.get("Dallas")?.(new Response(JSON.stringify({
      ok: true,
      results: [{ id: "osm-dallas", label: "Dallas", lon: -96.8, lat: 32.78 }],
    }), { headers: { "Content-Type": "application/json" } }));
    await expect(newer).resolves.toMatchObject({
      status: "success",
      selected_place: { label: "Dallas (place search result)" },
    });
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not apply a place result after the map context was superseded", async () => {
    const initial = {
      placeSelection: selection(),
      mapState: stateWithDate(),
    };
    const changed = {
      placeSelection: buildGeocodedPlaceSelection(
        "Los Angeles, California",
        { lon: -118.24, lat: 34.05 },
        25,
        "custom",
        "2026-08-25T00:00:00.000Z",
        "2026-08-25T23:59:59.000Z"
      ),
      mapState: { ...stateWithDate(), revision: 1 },
    };
    const readState = vi.fn()
      .mockReturnValueOnce(initial)
      .mockReturnValue(changed);
    const applyUpdate = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [{
        id: "osm-r-2688911",
        label: "Houston, Texas",
        lon: -95.36,
        lat: 29.76,
        boundingBox: null,
        adminContext: {},
      }],
    }), { headers: { "Content-Type": "application/json" } }));

    const output = await executeSetEnvironmentalMapLayersTool(
      { layers: { rain_satellite: true }, place: "Houston" },
      toolOptions(),
      { readState, applyUpdate, fetchImpl, now: () => NOW }
    );

    expect(output).toMatchObject({ status: "superseded", ui_updated: false });
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("does not surface stale ambiguity after a human map-context change", async () => {
    const initial = {
      placeSelection: selection(),
      mapState: stateWithDate(),
    };
    const changed = {
      placeSelection: buildGeocodedPlaceSelection(
        "Dallas, Texas",
        { lon: -96.8, lat: 32.78 },
        25,
        "custom",
        "2026-08-25T00:00:00.000Z",
        "2026-08-25T23:59:59.000Z"
      ),
      mapState: { ...stateWithDate(), revision: 1 },
    };
    const readState = vi.fn()
      .mockReturnValueOnce(initial)
      .mockReturnValue(changed);
    const applyUpdate = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [
        { id: "osm-a", label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
        { id: "osm-b", label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
      ],
    }), { headers: { "Content-Type": "application/json" } }));

    const output = await executeSetEnvironmentalMapLayersTool(
      { layers: { rain_satellite: true }, place: "Springfield" },
      toolOptions(),
      { readState, applyUpdate, fetchImpl, now: () => NOW }
    );

    expect(output).toMatchObject({ status: "superseded", ui_updated: false });
    expect(applyUpdate).not.toHaveBeenCalled();
  });
});
