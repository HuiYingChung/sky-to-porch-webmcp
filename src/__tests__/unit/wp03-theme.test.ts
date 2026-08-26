/**
 * src/__tests__/unit/wp03-theme.test.ts
 *
 * Deterministic unit tests for the WP-03 theme module.
 * Covers: getStoredThemeChoice, storeThemeChoice, resolveTheme,
 *         applyThemeToDocument, THEME_SCRIPT behavior (eval).
 *
 * C01 additions: System persistence, THEME_SCRIPT System branch,
 *                resolveTheme all branches, applyThemeToDocument class toggling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getStoredThemeChoice,
  storeThemeChoice,
  resolveTheme,
  applyThemeToDocument,
  THEME_SCRIPT,
  THEME_CHOICES,
} from "@/lib/ui/theme";

// ── localStorage mock ─────────────────────────────────────────────────────────

let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
  });
});

afterEach(() => {
  // Reset html classes
  document.documentElement.classList.remove("dark", "light");
});

// ── THEME_CHOICES ─────────────────────────────────────────────────────────────

describe("THEME_CHOICES", () => {
  it("contains exactly light, dark, system", () => {
    expect(THEME_CHOICES).toContain("light");
    expect(THEME_CHOICES).toContain("dark");
    expect(THEME_CHOICES).toContain("system");
    expect(THEME_CHOICES.length).toBe(3);
  });
});

// ── getStoredThemeChoice ──────────────────────────────────────────────────────

describe("getStoredThemeChoice", () => {
  it("returns null when nothing is stored", () => {
    expect(getStoredThemeChoice()).toBeNull();
  });

  it("returns 'light' when stored", () => {
    store["oth-theme"] = "light";
    expect(getStoredThemeChoice()).toBe("light");
  });

  it("returns 'dark' when stored", () => {
    store["oth-theme"] = "dark";
    expect(getStoredThemeChoice()).toBe("dark");
  });

  it("returns 'system' when stored (C01: System must be persisted)", () => {
    store["oth-theme"] = "system";
    expect(getStoredThemeChoice()).toBe("system");
  });

  it("returns null for an unrecognized stored value", () => {
    store["oth-theme"] = "sepia";
    expect(getStoredThemeChoice()).toBeNull();
  });
});

// ── storeThemeChoice ──────────────────────────────────────────────────────────

describe("storeThemeChoice", () => {
  it("stores 'light'", () => {
    storeThemeChoice("light");
    expect(store["oth-theme"]).toBe("light");
  });

  it("stores 'dark'", () => {
    storeThemeChoice("dark");
    expect(store["oth-theme"]).toBe("dark");
  });

  it("stores 'system' (C01: System must be persisted, not cleared)", () => {
    storeThemeChoice("system");
    expect(store["oth-theme"]).toBe("system");
  });

  it("removes the key when null is passed", () => {
    store["oth-theme"] = "dark";
    storeThemeChoice(null);
    expect(store["oth-theme"]).toBeUndefined();
  });
});

// ── resolveTheme ──────────────────────────────────────────────────────────────

describe("resolveTheme", () => {
  it("resolves 'light' to light regardless of OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
  });

  it("resolves 'dark' to dark regardless of OS", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("resolves 'system' to dark when OS prefers dark (C01)", () => {
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("resolves 'system' to light when OS prefers light (C01)", () => {
    expect(resolveTheme("system", false)).toBe("light");
  });
});

// ── applyThemeToDocument ──────────────────────────────────────────────────────

describe("applyThemeToDocument", () => {
  it("adds .dark and removes .light when resolved is dark", () => {
    document.documentElement.classList.add("light");
    applyThemeToDocument("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("removes .dark and adds .light when resolved is light", () => {
    document.documentElement.classList.add("dark");
    applyThemeToDocument("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("is idempotent: calling dark twice leaves .dark only", () => {
    applyThemeToDocument("dark");
    applyThemeToDocument("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });
});

// ── THEME_SCRIPT eval tests ───────────────────────────────────────────────────

/** Evaluate THEME_SCRIPT against a mock matchMedia and localStorage. */
function evalScript(stored: string | null, osPrefersDark: boolean) {
  store = stored !== null ? { "oth-theme": stored } : {};
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("dark") ? osPrefersDark : !osPrefersDark,
    }),
  });
  document.documentElement.classList.remove("dark", "light");
  eval(THEME_SCRIPT); // THEME_SCRIPT is static authored code only
}

describe("THEME_SCRIPT", () => {
  it("no stored → dark (dark-first default)", () => {
    evalScript(null, false); // OS is light, no stored value
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("stored 'dark' → dark", () => {
    evalScript("dark", false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("stored 'light' → light", () => {
    evalScript("light", true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("stored 'system' + OS dark → dark (C01)", () => {
    evalScript("system", true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("stored 'system' + OS light → light (C01)", () => {
    evalScript("system", false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
