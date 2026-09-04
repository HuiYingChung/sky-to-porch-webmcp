/// <reference types="webmcp-types" />

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider, useQueryDraft } from "@/components/query/query-provider";
import type { AnalysisOutcome, AnalysisRequest } from "@/lib/analysis/types";
import { executeAnalysisRequest } from "@/lib/analysis/client";
import {
  buildGeocodedPlaceSelection,
  type PlaceSelection,
} from "@/lib/location/selection";

vi.mock("@/lib/map/gibs-availability-client", () => ({
  loadGibsAvailability: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/lib/fire/firms-nrt-layer-client", () => ({
  loadWildfireLayer: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/lib/flood/extent-layer-client", () => ({
  loadFloodExtentLayer: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/lib/analysis/client", () => ({
  executeAnalysisRequest: vi.fn(async (request: AnalysisRequest) => ({
    hazardId: request.hazardId,
    result: {
      kind: "unsupported_place",
      rejectionReason: "Deterministic shared-map-state fixture.",
    },
  } as AnalysisOutcome)),
}));

let container: HTMLElement;
let root: Root;
let registeredTools: WebMCP.ModelContextTool[];

function MapStateProbe({ id }: { id: string }) {
  const context = useQueryDraft();
  const rain = context.environmentalMapState.layers.rain_satellite;
  const heat = context.environmentalMapState.layers.surface_heat_satellite;
  return (
    <output
      data-testid={id}
      data-place={context.placeSelection?.label ?? ""}
      data-date={context.environmentalMapState.date ?? ""}
      data-rain-visible={String(rain.visible)}
      data-rain-status={rain.status}
      data-heat-visible={String(heat.visible)}
      data-radius={context.placeSelection?.analysisArea.radiusKm ?? ""}
      data-focus-revision={context.environmentalMapState.agentFocusRevision}
      data-has-analysis={String(context.activeAnalysis !== null)}
    >
      <button
        type="button"
        data-testid={`${id}-hide-rain`}
        onClick={() => context.setEnvironmentalMapLayerVisible("rain_satellite", false)}
      >
        Hide rain
      </button>
    </output>
  );
}

function byTestId(id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Missing ${id}`);
  return element;
}

function deferredGeocodeRequests() {
  const pending = new Map<string, (response: Response) => void>();
  vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string };
    return new Promise<Response>((resolve) => {
      pending.set(body.query, resolve);
    });
  }));
  return pending;
}

function resolveGeocode(
  pending: Map<string, (response: Response) => void>,
  query: string,
  label: string,
  lon: number,
  lat: number
) {
  const resolve = pending.get(query);
  if (!resolve) throw new Error(`No pending geocode request for ${query}`);
  resolve(new Response(JSON.stringify({
    ok: true,
    results: [{ id: `osm-${query.toLowerCase().replaceAll(" ", "-")}`, label, lon, lat }],
  }), { headers: { "Content-Type": "application/json" } }));
}

beforeEach(async () => {
  registeredTools = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => {
        registeredTools.push(tool);
      }),
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      <QueryProvider>
        <MapStateProbe id="desktop-map-state" />
        <MapStateProbe id="mobile-map-state" />
      </QueryProvider>
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shared environmental map state", () => {
  it("cancels pending analysis on Agent reservation and lets a newer human selection supersede its geocode", async () => {
    let contextValue: ReturnType<typeof useQueryDraft> | undefined;
    function ContextCapture() {
      contextValue = useQueryDraft();
      return null;
    }
    await act(async () => {
      root.render(
        <QueryProvider>
          <ContextCapture />
          <MapStateProbe id="desktop-map-state" />
        </QueryProvider>
      );
    });
    const analyzeTool = registeredTools.find(
      (tool) => tool.name === "analyze_environmental_hazard"
    );
    if (!analyzeTool || !contextValue) throw new Error("analysis surfaces were not ready");

    const initialSelection = buildGeocodedPlaceSelection(
      "Austin, Texas",
      { lon: -97.74, lat: 30.27 },
      25,
      "custom",
      "2024-07-08T00:00:00.000Z",
      "2024-07-08T23:59:59.000Z"
    );
    const humanSelection = buildGeocodedPlaceSelection(
      "Dallas, Texas",
      { lon: -96.8, lat: 32.78 },
      25,
      "custom",
      "2024-07-09T00:00:00.000Z",
      "2024-07-09T23:59:59.000Z"
    );
    await act(async () => contextValue?.setPlaceSelection(initialSelection));

    vi.mocked(executeAnalysisRequest).mockClear();
    vi.mocked(executeAnalysisRequest).mockImplementationOnce(
      (_request, options) => new Promise((_resolve, reject) => {
        const signal = options?.signal;
        signal?.addEventListener("abort", () => {
          reject(signal.reason ?? new DOMException("cancelled", "AbortError"));
        }, { once: true });
      })
    );
    let pendingHumanAnalysis!: ReturnType<
      ReturnType<typeof useQueryDraft>["runAnalysis"]
    >;
    act(() => {
      pendingHumanAnalysis = contextValue!.runAnalysis({
        placeSelection: initialSelection,
        hazardId: "wind_storm",
        concern: "general",
        evidenceMode: "live",
      });
    });
    await vi.waitFor(() => expect(executeAnalysisRequest).toHaveBeenCalledTimes(1));

    let resolveGeocode: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveGeocode = resolve;
    })));
    let pendingAgentAnalysis!: Promise<unknown>;
    act(() => {
      pendingAgentAnalysis = Promise.resolve(analyzeTool.execute({
        place: "Houston",
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        time: "2024-07-08",
        question: "What official wind observations were recorded?",
      }, { signal: new AbortController().signal }));
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    let supersededHumanResult: Awaited<typeof pendingHumanAnalysis>;
    await act(async () => {
      supersededHumanResult = await pendingHumanAnalysis;
    });
    expect(supersededHumanResult!).toBeNull();

    await act(async () => contextValue?.setPlaceSelection(humanSelection));
    resolveGeocode?.(new Response(JSON.stringify({
      ok: true,
      results: [{ id: "osm-houston", label: "Houston, Texas", lon: -95.37, lat: 29.76 }],
    }), { headers: { "Content-Type": "application/json" } }));

    await expect(pendingAgentAnalysis).resolves.toMatchObject({
      status: "superseded",
      ui_updated: false,
    });
    expect(executeAnalysisRequest).toHaveBeenCalledTimes(1);
    expect(byTestId("desktop-map-state").dataset.place).toBe(
      "Dallas, Texas (OSM search)"
    );
  });

  it("uses one named-place invocation order across map and analysis tools", async () => {
    const mapTool = registeredTools.find(
      (tool) => tool.name === "set_environmental_map_layers"
    );
    const analyzeTool = registeredTools.find(
      (tool) => tool.name === "analyze_environmental_hazard"
    );
    if (!mapTool || !analyzeTool) throw new Error("context-mutating tools were not registered");
    const pending = deferredGeocodeRequests();
    const executeOptions = { signal: new AbortController().signal };
    vi.mocked(executeAnalysisRequest).mockClear();

    let olderMap!: Promise<unknown>;
    act(() => {
      olderMap = Promise.resolve(mapTool.execute({
        layers: { rain_satellite: true },
        place: "Houston",
        date: "2024-07-08",
      }, executeOptions));
    });
    await vi.waitFor(() => expect(pending.has("Houston")).toBe(true));
    let newerAnalysis!: Promise<unknown>;
    act(() => {
      newerAnalysis = Promise.resolve(analyzeTool.execute({
        place: "Dallas",
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        time: "2024-07-08",
        question: "What official wind observations were recorded?",
      }, executeOptions));
    });
    await vi.waitFor(() => expect(pending.has("Dallas")).toBe(true));

    let olderMapOutput: unknown;
    await act(async () => {
      resolveGeocode(pending, "Houston", "Houston, Texas", -95.37, 29.76);
      olderMapOutput = await olderMap;
    });
    expect(olderMapOutput!).toMatchObject({ status: "superseded", ui_updated: false });
    expect(executeAnalysisRequest).not.toHaveBeenCalled();

    let newerAnalysisOutput: unknown;
    await act(async () => {
      resolveGeocode(pending, "Dallas", "Dallas, Texas", -96.8, 32.78);
      newerAnalysisOutput = await newerAnalysis;
    });
    expect(newerAnalysisOutput!).toMatchObject({ status: "unsupported_place", ui_updated: true });
    expect(executeAnalysisRequest).toHaveBeenCalledTimes(1);
    expect(byTestId("desktop-map-state").dataset.place).toBe(
      "Dallas, Texas (OSM search)"
    );

    let olderAnalysis!: Promise<unknown>;
    act(() => {
      olderAnalysis = Promise.resolve(analyzeTool.execute({
        place: "Austin",
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        time: "2024-07-08",
        question: "What official wind observations were recorded?",
      }, executeOptions));
    });
    await vi.waitFor(() => expect(pending.has("Austin")).toBe(true));
    let newerMap!: Promise<unknown>;
    act(() => {
      newerMap = Promise.resolve(mapTool.execute({
        layers: { surface_heat_satellite: true },
        place: "San Antonio",
        date: "2024-07-08",
      }, executeOptions));
    });
    await vi.waitFor(() => expect(pending.has("San Antonio")).toBe(true));

    let olderAnalysisOutput: unknown;
    await act(async () => {
      resolveGeocode(pending, "Austin", "Austin, Texas", -97.74, 30.27);
      olderAnalysisOutput = await olderAnalysis;
    });
    expect(olderAnalysisOutput!).toMatchObject({ status: "superseded", ui_updated: false });
    expect(executeAnalysisRequest).toHaveBeenCalledTimes(1);

    let newerMapOutput: unknown;
    await act(async () => {
      resolveGeocode(
        pending,
        "San Antonio",
        "San Antonio, Texas",
        -98.49,
        29.42
      );
      newerMapOutput = await newerMap;
    });
    expect(newerMapOutput!).toMatchObject({
      status: "success",
      selected_place: { label: "San Antonio, Texas (OSM search)" },
    });
    expect(byTestId("desktop-map-state").dataset.place).toBe(
      "San Antonio, Texas (OSM search)"
    );
  });

  it("does not let a pure layer toggle claim a pending analysis context", async () => {
    const mapTool = registeredTools.find(
      (tool) => tool.name === "set_environmental_map_layers"
    );
    const analyzeTool = registeredTools.find(
      (tool) => tool.name === "analyze_environmental_hazard"
    );
    if (!mapTool || !analyzeTool) throw new Error("context-mutating tools were not registered");
    const pending = deferredGeocodeRequests();
    const executeOptions = { signal: new AbortController().signal };
    vi.mocked(executeAnalysisRequest).mockClear();

    let pendingAnalysis!: Promise<unknown>;
    act(() => {
      pendingAnalysis = Promise.resolve(analyzeTool.execute({
        place: "Dallas",
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        time: "2024-07-08",
        question: "What official wind observations were recorded?",
      }, executeOptions));
    });
    await vi.waitFor(() => expect(pending.has("Dallas")).toBe(true));

    let layerOutput: unknown;
    await act(async () => {
      layerOutput = await Promise.resolve(mapTool.execute({
        layers: { rain_satellite: false },
      }, executeOptions));
    });
    expect(layerOutput!).toMatchObject({
      status: "success",
      analysis_cleared: false,
    });

    let analysisOutput: unknown;
    await act(async () => {
      resolveGeocode(pending, "Dallas", "Dallas, Texas", -96.8, 32.78);
      analysisOutput = await pendingAnalysis;
    });
    expect(analysisOutput!).toMatchObject({ status: "unsupported_place", ui_updated: true });
    expect(executeAnalysisRequest).toHaveBeenCalledTimes(1);
    expect(byTestId("desktop-map-state").dataset.place).toBe(
      "Dallas, Texas (OSM search)"
    );
  });

  it("keeps desktop and mobile consumers synchronized across Agent and human updates", async () => {
    const mapTool = registeredTools.find(
      (tool) => tool.name === "set_environmental_map_layers"
    );
    if (!mapTool) throw new Error("map tool was not registered");

    const selection = buildGeocodedPlaceSelection(
      "Houston, Texas",
      { lon: -95.3698, lat: 29.7604 },
      25,
      "custom",
      "2024-07-08T00:00:00Z",
      "2024-07-08T23:59:59Z",
      { west: -95.91, south: 29.52, east: -95.01, north: 30.11 }
    );

    // Install a human selection through the same public context surface used
    // by the query UI, without introducing a second map-state owner.
    let setSelection: ((nextSelection: PlaceSelection) => void) | undefined;
    let runAnalysis:
      | ReturnType<typeof useQueryDraft>["runAnalysis"]
      | undefined;
    function SelectionSetter() {
      const context = useQueryDraft();
      setSelection = context.setPlaceSelection;
      runAnalysis = context.runAnalysis;
      return null;
    }
    await act(async () => {
      root.render(
        <QueryProvider>
          <SelectionSetter />
          <MapStateProbe id="desktop-map-state" />
          <MapStateProbe id="mobile-map-state" />
        </QueryProvider>
      );
    });
    await act(async () => setSelection?.(selection));

    await act(async () => {
      await runAnalysis?.({
        placeSelection: selection,
        hazardId: "fire_smoke",
        concern: "general",
        evidenceMode: "live",
      });
    });
    expect(byTestId("desktop-map-state").dataset.hasAnalysis).toBe("true");

    let layerOnlyOutput: unknown;
    await act(async () => {
      layerOnlyOutput = await mapTool.execute(
        { layers: { rain_satellite: true } },
        { signal: new AbortController().signal }
      );
    });
    expect(layerOnlyOutput).toMatchObject({ analysis_cleared: false });

    for (const id of ["desktop-map-state", "mobile-map-state"]) {
      expect(byTestId(id).dataset).toMatchObject({
        place: "Houston, Texas (OSM search)",
        date: "2024-07-08",
        rainVisible: "true",
        rainStatus: "loading",
        focusRevision: "1",
        hasAnalysis: "true",
      });
    }

    await act(async () => byTestId("mobile-map-state-hide-rain").click());
    for (const id of ["desktop-map-state", "mobile-map-state"]) {
      expect(byTestId(id).dataset).toMatchObject({
        rainVisible: "false",
        rainStatus: "hidden",
        focusRevision: "1",
      });
    }

    let contextMutationOutput: unknown;
    await act(async () => {
      contextMutationOutput = await mapTool.execute(
        { layers: { rain_satellite: false }, radius_km: 30 },
        { signal: new AbortController().signal }
      );
    });
    expect(contextMutationOutput).toMatchObject({
      analysis_cleared: true,
      selected_place: { radius_km: 30 },
    });
    for (const id of ["desktop-map-state", "mobile-map-state"]) {
      expect(byTestId(id).dataset).toMatchObject({
        hasAnalysis: "false",
        focusRevision: "2",
      });
    }
  });

  it("uses authoritative refs for two same-tick map calls without reverting context", async () => {
    const mapTool = registeredTools.find(
      (tool) => tool.name === "set_environmental_map_layers"
    );
    if (!mapTool) throw new Error("map tool was not registered");

    const selection = buildGeocodedPlaceSelection(
      "Houston, Texas",
      { lon: -95.3698, lat: 29.7604 },
      25,
      "custom",
      "2024-07-08T00:00:00Z",
      "2024-07-08T23:59:59Z",
      { west: -95.91, south: 29.52, east: -95.01, north: 30.11 }
    );
    let setSelection: ((nextSelection: PlaceSelection) => void) | undefined;
    function SelectionSetter() {
      setSelection = useQueryDraft().setPlaceSelection;
      return null;
    }
    await act(async () => {
      root.render(
        <QueryProvider>
          <SelectionSetter />
          <MapStateProbe id="desktop-map-state" />
          <MapStateProbe id="mobile-map-state" />
        </QueryProvider>
      );
    });
    await act(async () => setSelection?.(selection));

    let secondOutput: unknown;
    await act(async () => {
      // Deliberately do not await the first promise before starting the second.
      // Both executions run synchronously through applyUpdate before yielding.
      const first = mapTool.execute(
        { layers: { rain_satellite: true }, radius_km: 30 },
        { signal: new AbortController().signal }
      );
      const second = mapTool.execute(
        { layers: { surface_heat_satellite: true } },
        { signal: new AbortController().signal }
      );
      [, secondOutput] = await Promise.all([first, second]);
    });

    expect(secondOutput).toMatchObject({
      status: "success",
      selected_place: { radius_km: 30 },
      layers: {
        rain_satellite: { requested: true },
        surface_heat_satellite: { requested: true },
      },
    });
    for (const id of ["desktop-map-state", "mobile-map-state"]) {
      expect(byTestId(id).dataset).toMatchObject({
        radius: "30",
        rainVisible: "true",
        heatVisible: "true",
        focusRevision: "2",
      });
    }
  });
});
