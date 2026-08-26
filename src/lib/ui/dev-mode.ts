"use client";
/**
 * src/lib/ui/dev-mode.ts
 *
 * UXFIX-01: Developer-mode gate for test-harness UI (fixture evidence mode).
 *
 * Fixture mode is a deterministic regression harness, not a product feature.
 * It stays fully implemented and server-supported, but its UI entry point is
 * shown only when:
 *   - the app runs in development (`next dev`), or
 *   - the URL contains ?dev=1 (production builds, E2E, live demos that need
 *     the deterministic cases).
 *
 * The gate is presentation-only. The server routes continue to accept and
 * validate fixture requests regardless of this flag, so API behavior and
 * existing integration tests are unchanged.
 */

import { useEffect, useState } from "react";

/** True when developer-only UI (fixture mode selection) should be rendered. */
export function useDevMode(): boolean {
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      setDevMode(true);
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      setDevMode(params.get("dev") === "1");
    } catch {
      setDevMode(false);
    }
  }, []);

  return devMode;
}

/**
 * ADR-0045: stricter gate for the "Dev test scenarios" place shortcuts.
 * Unlike useDevMode, `next dev` alone does NOT enable it — only an explicit
 * ?dev=1 does — so the everyday development view stays free of test-harness
 * clutter while E2E (which always navigates with ?dev=1) keeps its
 * deterministic lake-michigan / source-failure entry points.
 */
export function useDevUrlMode(): boolean {
  const [devUrlMode, setDevUrlMode] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setDevUrlMode(params.get("dev") === "1");
    } catch {
      setDevUrlMode(false);
    }
  }, []);

  return devUrlMode;
}
