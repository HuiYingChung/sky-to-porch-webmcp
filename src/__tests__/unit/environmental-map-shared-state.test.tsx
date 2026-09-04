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
      data-place-focus-revision={context.environmentalMapState.placeFocusRevision}
      data-has-analysis={String(context.activeAnalysis !== null)}
      data-place-lookup-status={context.agentPlaceLookupReceipt?.status ?? ""}
      data-place-choice-count={context.agentPlaceLookupReceipt?.status === "needs_place_choice"
        ? context.agentPlaceLookupReceipt.choices.length
        : 0}
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
      "Dallas, Texas (place search result)"
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
      "Dallas, Texas (place search result)"
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
    expect(olderAnalysisOutput!).toMatchObject({ status: "unsupported_place", ui_updated: true });
    expect(executeAnalysisRequest).toHaveBeenCalledTimes(2);

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
      selected_place: { label: "San Antonio, Texas (place search result)" },
    });
    expect(byTestId("desktop-map-state").dataset.place).toBe(
      "San Antonio, Texas (place search result)"
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
      "Dallas, Texas (place search result)"
    );
  });

  it.each([
    {
      lookupName: "an ambiguous place search",
      lookupResponse: new Response(JSON.stringify({
        ok: true,
        results: [
          { id: "springfield-il", label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
          { id: "springfield-mo", label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
        ],
      }), { headers: { "Content-Type": "application/json" } }),
      lookupStatus: "needs_place_choice",
    },
    {
      lookupName: "a failed place search",
      lookupResponse: new Response("busy", { status: 429 }),
      lookupStatus: "place_lookup_failed",
    },
  ])("lets active analysis finish after $lookupName", async ({
    lookupResponse,
    lookupStatus,
  }) => {
    const analyzeTool = registeredTools.find(
      (tool) => tool.name === "analyze_environmental_hazard"
    );
    const placeTool = registeredTools.find(
      (tool) => tool.name === "look_up_place_location"
    );
    if (!analyzeTool || !placeTool) throw new Error("place and analysis tools were not registered");
    const pendingGeocodes = deferredGeocodeRequests();
    const executeOptions = { signal: new AbortController().signal };
    let finishAnalysis: ((outcome: AnalysisOutcome) => void) | undefined;
    vi.mocked(executeAnalysisRequest).mockClear();
    vi.mocked(executeAnalysisRequest).mockImplementationOnce(
      () => new Promise<AnalysisOutcome>((resolve) => {
        finishAnalysis = resolve;
      })
    );

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
    await vi.waitFor(() => expect(pendingGeocodes.has("Dallas")).toBe(true));
    await act(async () => {
      resolveGeocode(pendingGeocodes, "Dallas", "Dallas, Texas", -96.8, 32.78);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(executeAnalysisRequest).toHaveBeenCalledOnce());

    let pendingLookup!: Promise<unknown>;
    act(() => {
      pendingLookup = Promise.resolve(placeTool.execute(
        { place: "Springfield" },
        executeOptions
      ));
    });
    await vi.waitFor(() => expect(pendingGeocodes.has("Springfield")).toBe(true));
    let lookupOutput: unknown;
    await act(async () => {
      pendingGeocodes.get("Springfield")?.(lookupResponse);
      lookupOutput = await pendingLookup;
    });
    expect(lookupOutput!).toMatchObject({
      status: lookupStatus,
      ui_updated: true,
      map_updated: false,
    });

    let analysisOutput: unknown;
    await act(async () => {
      finishAnalysis?.({
        hazardId: "wind_storm",
        result: {
          kind: "unsupported_place",
          rejectionReason: "Deterministic shared-map-state fixture.",
        },
      } as AnalysisOutcome);
      analysisOutput = await pendingAnalysis;
    });
    expect(analysisOutput!).toMatchObject({
      status: "unsupported_place",
      ui_updated: true,
    });
    expect(byTestId("desktop-map-state").dataset).toMatchObject({
      place: "Dallas, Texas (place search result)",
      hasAnalysis: "true",
      placeLookupStatus: lookupStatus,
    });
  });

  it("prevents older analysis from replacing a newer successful place selection", async () => {
    const analyzeTool = registeredTools.find(
      (tool) => tool.name === "analyze_environmental_hazard"
    );
    const placeTool = registeredTools.find(
      (tool) => tool.name === "look_up_place_location"
    );
    if (!analyzeTool || !placeTool) throw new Error("place and analysis tools were not registered");
    const pendingGeocodes = deferredGeocodeRequests();
    const executeOptions = { signal: new AbortController().signal };
    let finishAnalysis: ((outcome: AnalysisOutcome) => void) | undefined;
    vi.mocked(executeAnalysisRequest).mockClear();
    vi.mocked(executeAnalysisRequest).mockImplementationOnce(
      () => new Promise<AnalysisOutcome>((resolve) => {
        finishAnalysis = resolve;
      })
    );

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
    await vi.waitFor(() => expect(pendingGeocodes.has("Dallas")).toBe(true));
    await act(async () => {
      resolveGeocode(pendingGeocodes, "Dallas", "Dallas, Texas", -96.8, 32.78);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(executeAnalysisRequest).toHaveBeenCalledOnce());

    let pendingLookup!: Promise<unknown>;
    act(() => {
      pendingLookup = Promise.resolve(placeTool.execute(
        { place: "Houston" },
        executeOptions
      ));
    });
    await vi.waitFor(() => expect(pendingGeocodes.has("Houston")).toBe(true));
    let lookupOutput: unknown;
    await act(async () => {
      resolveGeocode(pendingGeocodes, "Houston", "Houston, Texas", -95.37, 29.76);
      lookupOutput = await pendingLookup;
    });
    expect(lookupOutput!).toMatchObject({
      status: "success",
      selection_updated: true,
      analysis_cleared: true,
      ui_updated: true,
    });

    let analysisOutput: unknown;
    await act(async () => {
      finishAnalysis?.({
        hazardId: "wind_storm",
        result: {
          kind: "unsupported_place",
          rejectionReason: "Late result that must stay hidden.",
        },
      } as AnalysisOutcome);
      analysisOutput = await pendingAnalysis;
    });
    expect(analysisOutput).toMatchObject({
      status: "superseded",
      ui_updated: false,
    });
    expect(byTestId("desktop-map-state").dataset).toMatchObject({
      place: "Houston, Texas (place search result)",
      hasAnalysis: "false",
      placeLookupStatus: "success",
    });
  });

  it("lets a same-place lookup keep matching results while stopping an older different-place request", async () => {
    const analyzeTool = registeredTools.find(
      (tool) => tool.name === "analyze_environmental_hazard"
    );
    const placeTool = registeredTools.find(
      (tool) => tool.name === "look_up_place_location"
    );
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
          <MapStateProbe id="mobile-map-state" />
        </QueryProvider>
      );
    });
    if (!analyzeTool || !placeTool || !contextValue) {
      throw new Error("place and analysis surfaces were not ready");
    }
    const austin = buildGeocodedPlaceSelection(
      "Austin, Texas",
      { lon: -97.74, lat: 30.27 },
      25,
      "custom",
      "2024-07-08T00:00:00.000Z",
      "2024-07-08T23:59:59.000Z"
    );
    await act(async () => {
      contextValue!.setPlaceSelection(austin);
      contextValue!.setEnvironmentalMapLayerVisible("rain_satellite", true);
      await contextValue!.runAnalysis({
        placeSelection: austin,
        hazardId: "wind_storm",
        concern: "general",
        evidenceMode: "live",
      });
    });
    expect(byTestId("desktop-map-state").dataset).toMatchObject({
      place: "Austin, Texas (place search result)",
      rainVisible: "true",
      hasAnalysis: "true",
      placeFocusRevision: "0",
    });

    const pendingGeocodes = deferredGeocodeRequests();
    const executeOptions = { signal: new AbortController().signal };
    vi.mocked(executeAnalysisRequest).mockClear();
    let olderAnalysis!: Promise<unknown>;
    act(() => {
      olderAnalysis = Promise.resolve(analyzeTool.execute({
        place: "Dallas",
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        time: "2024-07-08",
        question: "What official wind observations were recorded?",
      }, executeOptions));
    });
    await vi.waitFor(() => expect(pendingGeocodes.has("Dallas")).toBe(true));

    let samePlaceLookup!: Promise<unknown>;
    act(() => {
      samePlaceLookup = Promise.resolve(placeTool.execute(
        { place: "Austin" },
        executeOptions
      ));
    });
    await vi.waitFor(() => expect(pendingGeocodes.has("Austin")).toBe(true));
    let samePlaceOutput: unknown;
    await act(async () => {
      resolveGeocode(pendingGeocodes, "Austin", "Austin, Texas", -97.74, 30.27);
      samePlaceOutput = await samePlaceLookup;
    });
    expect(samePlaceOutput).toMatchObject({
      status: "success",
      selection_updated: false,
      analysis_cleared: false,
      map_updated: true,
      map_focus_revision: 1,
    });

    let olderOutput: unknown;
    await act(async () => {
      resolveGeocode(pendingGeocodes, "Dallas", "Dallas, Texas", -96.8, 32.78);
      olderOutput = await olderAnalysis;
    });
    expect(olderOutput).toMatchObject({ status: "superseded", ui_updated: false });
    expect(executeAnalysisRequest).not.toHaveBeenCalled();
    expect(byTestId("desktop-map-state").dataset).toMatchObject({
      place: "Austin, Texas (place search result)",
      rainVisible: "true",
      hasAnalysis: "true",
      placeFocusRevision: "1",
      placeLookupStatus: "success",
    });
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
        place: "Houston, Texas (place search result)",
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

  it("synchronizes a unique place lookup across both views without changing map preferences", async () => {
    const placeTool = registeredTools.find(
      (tool) => tool.name === "look_up_place_location"
    );
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
          <MapStateProbe id="mobile-map-state" />
        </QueryProvider>
      );
    });
    if (!placeTool || !contextValue) throw new Error("place lookup surface was not ready");

    const initial = buildGeocodedPlaceSelection(
      "Austin, Texas",
      { lon: -97.74, lat: 30.27 },
      40,
      "custom",
      "2024-07-08T00:00:00.000Z",
      "2024-07-08T23:59:59.000Z"
    );
    await act(async () => {
      contextValue!.setPlaceSelection(initial);
      contextValue!.setEnvironmentalMapLayerVisible("rain_satellite", true);
      await contextValue!.runAnalysis({
        placeSelection: initial,
        hazardId: "wind_storm",
        concern: "general",
        evidenceMode: "live",
      });
    });
    expect(byTestId("desktop-map-state").dataset.hasAnalysis).toBe("true");

    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        results: [{
          id: "osm-houston",
          label: "Houston, Texas, United States",
          lon: -95.3677,
          lat: 29.7589,
          boundingBox: { west: -95.91, south: 29.52, east: -95.01, north: 30.11 },
          adminContext: { city: "Houston", state: "Texas", country: "United States" },
        }],
      }), { headers: { "Content-Type": "application/json" } });
    }));

    let output: unknown;
    await act(async () => {
      output = await placeTool.execute(
        { place: "Houston" },
        { signal: new AbortController().signal }
      );
    });

    expect(output).toMatchObject({
      status: "success",
      ui_updated: true,
      map_updated: true,
      selection_updated: true,
      analysis_cleared: true,
      selected_place: { radius_km: 40 },
    });
    for (const id of ["desktop-map-state", "mobile-map-state"]) {
      expect(byTestId(id).dataset).toMatchObject({
        place: "Houston, Texas, United States (place search result)",
        date: "2024-07-08",
        radius: "40",
        rainVisible: "true",
        hasAnalysis: "false",
        focusRevision: "1",
        placeFocusRevision: "1",
        placeLookupStatus: "success",
      });
    }
    expect(contextValue.placeSelection?.timeSelection).toMatchObject({
      type: "custom",
      startTs: "2024-07-08T00:00:00.000Z",
      endTs: "2024-07-08T23:59:59.000Z",
    });

    await act(async () => {
      await contextValue!.runAnalysis({
        placeSelection: contextValue!.placeSelection!,
        hazardId: "wind_storm",
        concern: "general",
        evidenceMode: "live",
      });
    });
    expect(byTestId("desktop-map-state").dataset.hasAnalysis).toBe("true");

    let samePlaceOutput: unknown;
    await act(async () => {
      samePlaceOutput = await placeTool.execute(
        { place: "Houston" },
        { signal: new AbortController().signal }
      );
    });
    expect(samePlaceOutput).toMatchObject({
      status: "success",
      selection_updated: false,
      analysis_cleared: false,
      map_updated: true,
      map_focus_revision: 2,
    });
    for (const id of ["desktop-map-state", "mobile-map-state"]) {
      expect(byTestId(id).dataset).toMatchObject({
        place: "Houston, Texas, United States (place search result)",
        date: "2024-07-08",
        radius: "40",
        rainVisible: "true",
        hasAnalysis: "true",
        focusRevision: "2",
        placeFocusRevision: "2",
        placeLookupStatus: "success",
      });
    }
  });

  it("shows every ambiguous candidate and failures without touching the current map or evidence", async () => {
    const placeTool = registeredTools.find(
      (tool) => tool.name === "look_up_place_location"
    );
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
          <MapStateProbe id="mobile-map-state" />
        </QueryProvider>
      );
    });
    if (!placeTool || !contextValue) throw new Error("place lookup surface was not ready");

    const initial = buildGeocodedPlaceSelection(
      "Austin, Texas",
      { lon: -97.74, lat: 30.27 },
      25,
      "custom",
      "2024-07-08T00:00:00.000Z",
      "2024-07-08T23:59:59.000Z"
    );
    await act(async () => {
      contextValue!.setPlaceSelection(initial);
      contextValue!.setEnvironmentalMapLayerVisible("rain_satellite", true);
      await contextValue!.runAnalysis({
        placeSelection: initial,
        hazardId: "wind_storm",
        concern: "general",
        evidenceMode: "live",
      });
    });
    const before = { ...byTestId("desktop-map-state").dataset };
    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response(JSON.stringify({
        ok: true,
        results: [
          {
            id: "osm-springfield-il",
            label: "Springfield, Illinois, United States",
            lon: -89.65,
            lat: 39.78,
            boundingBox: { west: -89.8, south: 39.6, east: -89.5, north: 39.9 },
            adminContext: { city: "Springfield", state: "Illinois", country: "United States" },
          },
          {
            id: "osm-springfield-mo",
            label: "Springfield, Missouri, United States",
            lon: -93.29,
            lat: 37.21,
            adminContext: { city: "Springfield", state: "Missouri", country: "United States" },
          },
        ],
      }), { headers: { "Content-Type": "application/json" } });
    }));

    let ambiguous: unknown;
    await act(async () => {
      ambiguous = await placeTool.execute(
        { place: "Springfield" },
        { signal: new AbortController().signal }
      );
    });
    expect(ambiguous).toMatchObject({
      status: "needs_place_choice",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
      choices: [
        { representative_point: { latitude: 39.78, longitude: -89.65 } },
        { representative_point: { latitude: 37.21, longitude: -93.29 } },
      ],
    });
    for (const id of ["desktop-map-state", "mobile-map-state"]) {
      expect(byTestId(id).dataset).toMatchObject({
        place: before.place,
        date: before.date,
        radius: before.radius,
        rainVisible: before.rainVisible,
        focusRevision: before.focusRevision,
        hasAnalysis: "true",
        placeLookupStatus: "needs_place_choice",
        placeChoiceCount: "2",
      });
    }

    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 429 })));
    let failed: unknown;
    await act(async () => {
      failed = await placeTool.execute(
        { place: "Springfield" },
        { signal: new AbortController().signal }
      );
    });
    expect(failed).toMatchObject({
      status: "place_lookup_failed",
      ui_updated: true,
      map_updated: false,
      map_unchanged: true,
      reason: "rate_limited",
    });
    expect(byTestId("desktop-map-state").dataset).toMatchObject({
      place: before.place,
      date: before.date,
      rainVisible: before.rainVisible,
      focusRevision: before.focusRevision,
      hasAnalysis: "true",
      placeLookupStatus: "place_lookup_failed",
      placeChoiceCount: "0",
    });
  });
});
