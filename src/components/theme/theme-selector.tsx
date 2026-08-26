"use client";
/**
 * src/components/theme/theme-selector.tsx
 *
 * Accessible Light / Dark theme selector.
 *
 * - Both choices are keyboard-operable (button group, aria-pressed).
 * - Choices are persisted to localStorage as "light" or "dark".
 * - A legacy stored "system" choice is migrated once to the current resolved
 *   OS theme so one of the two visible controls is always selected.
 * - Multiple instances (desktop + mobile headers) share one ThemeContext so
 *   aria-pressed state stays synchronized after viewport resizing.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  type ThemeChoice,
  getStoredThemeChoice,
  storeThemeChoice,
  resolveTheme,
  applyThemeToDocument,
} from "@/lib/ui/theme";

// ── Shared theme context ──────────────────────────────────────────────────────

interface ThemeContextValue {
  choice: ThemeChoice;
  setChoice: (c: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * ThemeProvider — must wrap any tree that contains <ThemeSelector>.
 * Provides one shared choice/setter to all instances.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Keep the server and first client render identical. THEME_SCRIPT already
  // applies the stored visual theme before paint; the effect below then syncs
  // the selector state without producing a hydration mismatch.
  const [choice, setChoiceState] = useState<ThemeChoice>("dark");

  const applyAndStore = useCallback((next: ThemeChoice) => {
    storeThemeChoice(next);
    const prefersDark =
      typeof window !== "undefined"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : true;
    applyThemeToDocument(resolveTheme(next, prefersDark));
    setChoiceState(next);
  }, []);

  // On mount, migrate the removed System option to one explicit visible theme.
  useEffect(() => {
    const stored = getStoredThemeChoice() ?? "dark";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const explicitChoice = stored === "system" ? resolveTheme(stored, prefersDark) : stored;
    if (stored === "system") storeThemeChoice(explicitChoice);
    applyThemeToDocument(explicitChoice);
    setChoiceState(explicitChoice);
  }, []);

  return (
    <ThemeContext.Provider value={{ choice, setChoice: applyAndStore }}>
      {children}
    </ThemeContext.Provider>
  );
}

function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("ThemeSelector must be used inside <ThemeProvider>");
  return ctx;
}

// ── ThemeSelector component ───────────────────────────────────────────────────

type VisibleThemeChoice = Exclude<ThemeChoice, "system">;

const VISIBLE_THEME_CHOICES: readonly VisibleThemeChoice[] = ["light", "dark"];
const THEME_LABELS: Record<VisibleThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
};

export function ThemeSelector() {
  const { choice, setChoice } = useTheme();

  return (
    <div
      role="group"
      aria-label="Color theme"
      style={{ display: "flex", gap: "2px" }}
    >
      {VISIBLE_THEME_CHOICES.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={choice === t}
          aria-label={`${THEME_LABELS[t]} theme`}
          onClick={() => setChoice(t)}
          data-testid={`theme-btn-${t}`}
          style={{
            padding: "4px 10px",
            fontSize: "14px",
            fontWeight: choice === t ? 600 : 400,
            border: "1px solid var(--border-default)",
            borderRadius: "4px",
            background: choice === t ? "var(--surface-3)" : "var(--surface-1)",
            color: "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          {THEME_LABELS[t]}
        </button>
      ))}
    </div>
  );
}
