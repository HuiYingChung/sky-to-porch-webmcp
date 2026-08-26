/// <reference types="webmcp-types" />

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebMcpBridge } from "@/components/webmcp/webmcp-bridge";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  Reflect.deleteProperty(document, "modelContext");
});

describe("WebMcpBridge", () => {
  it("registers once and unregisters through the registration AbortSignal", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const onStatusChange = vi.fn();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    const runAnalysis = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <WebMcpBridge
          runAnalysis={runAnalysis}
          onStatusChange={onStatusChange}
        />
      );
    });

    expect(registerTool).toHaveBeenCalledTimes(1);
    const [tool, registrationOptions] = registerTool.mock.calls[0] as [
      WebMCP.ModelContextTool,
      WebMCP.ModelContextRegisterToolOptions,
    ];
    expect(tool.name).toBe("analyze_environmental_hazard");
    expect(registrationOptions.signal?.aborted).toBe(false);
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      "registering",
      "ready",
    ]);

    act(() => root?.unmount());
    root = null;
    expect(registrationOptions.signal?.aborted).toBe(true);
  });

  it("is a no-op in browsers without WebMCP", async () => {
    const onStatusChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <WebMcpBridge
          runAnalysis={vi.fn()}
          onStatusChange={onStatusChange}
        />
      );
    });

    expect(container.innerHTML).toBe("");
    expect(onStatusChange).toHaveBeenCalledWith("unsupported");
  });
});
