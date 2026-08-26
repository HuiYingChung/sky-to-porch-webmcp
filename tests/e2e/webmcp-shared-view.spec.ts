import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

test("registers WebMCP and shares an agent analysis with the visible product", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTool?: WebMCP.ModelContextTool;
    };
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: async (tool: WebMCP.ModelContextTool) => {
          state.__skyToPorchWebMcpTool = tool;
        },
      },
    });
  });

  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/fire/query", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "unsupported_place",
          rejectionReason: "Deterministic WebMCP E2E boundary.",
        },
      }),
    });
  });

  await gotoHydrated(page, "/");
  await expect(page.locator('[data-testid="webmcp-ready-badge"]:visible'))
    .toHaveText("Agent-ready");

  const registered = await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTool?: WebMCP.ModelContextTool;
    };
    return state.__skyToPorchWebMcpTool
      ? {
          name: state.__skyToPorchWebMcpTool.name,
          annotations: state.__skyToPorchWebMcpTool.annotations,
        }
      : null;
  });
  expect(registered).toEqual({
    name: "analyze_environmental_hazard",
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  });

  const output = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTool?: WebMCP.ModelContextTool;
    };
    if (!state.__skyToPorchWebMcpTool) throw new Error("WebMCP tool was not registered");
    return state.__skyToPorchWebMcpTool.execute(
      {
        place: "Tucson, Arizona",
        hazard: "fire_smoke",
        concern: "pets",
        latitude: 32.2226,
        longitude: -110.9747,
        radius_km: 15,
      },
      { signal: new AbortController().signal }
    );
  }) as Record<string, unknown>;

  expect(output).toMatchObject({
    status: "unsupported_place",
    ui_updated: true,
    no_data_is_not_no_danger: true,
    request: {
      hazard: "fire_smoke",
      concern: "pets",
      radius_km: 15,
    },
  });
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(1_500);
  expect(requestBody).toMatchObject({
    placeId: "custom-area",
    mode: "live",
    concern: "pets",
    time: { kind: "latest", days: 1 },
  });

  await expect(page.locator('[data-testid="agent-analysis-notice"]').first())
    .toContainText("Agent updated this view");
  await expect(page.locator(
    '[data-testid="map-area"] [data-testid="selection-summary"]'
  )).toHaveAttribute("data-selection-method", "agent_coordinate");

  if (testInfo.project.name === "chromium-mobile") {
    await expect(page.getByTestId("mobile-nav-insight")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  }
});
