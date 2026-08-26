/**
 * src/lib/ui/theme.ts
 *
 * Theme management: Light, Dark, System.
 *
 * - Explicit Light/Dark/System choices are persisted to localStorage.
 * - System follows the OS prefers-color-scheme and responds to live changes.
 * - The .dark and .light classes are applied to <html> based on the resolved theme.
 * - Dark-first: the initial first-visit default (no stored choice) is dark.
 *
 * No runtime dependencies beyond the browser DOM.
 */

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"] as const;

const STORAGE_KEY = "oth-theme";

/**
 * Read the persisted choice from localStorage.
 * Returns "light", "dark", "system", or null (no stored value → dark-first default).
 */
export function getStoredThemeChoice(): ThemeChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage unavailable — fall back to default
  }
  return null;
}

/**
 * Persist the user's explicit choice.
 * Pass null to clear (restores dark-first default on next load).
 */
export function storeThemeChoice(choice: ThemeChoice | null): void {
  if (typeof window === "undefined") return;
  try {
    if (choice === "light" || choice === "dark" || choice === "system") {
      localStorage.setItem(STORAGE_KEY, choice);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

/** Derive the resolved theme (light or dark) from a choice and the current OS preference. */
export function resolveTheme(
  choice: ThemeChoice,
  prefersDark: boolean
): "light" | "dark" {
  if (choice === "light") return "light";
  if (choice === "dark") return "dark";
  // System: follow the OS preference
  return prefersDark ? "dark" : "light";
}

/** Apply the resolved theme classes to <html>. */
export function applyThemeToDocument(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.remove("dark");
    root.classList.add("light");
  }
}

/**
 * Returns the initial ThemeChoice for SSR — always "dark" (dark-first).
 * The browser script and client hydration correct this before paint.
 */
export function getDefaultThemeChoice(): ThemeChoice {
  return "dark";
}

/**
 * Inline script content to inject into <head> to prevent flash-of-wrong-theme.
 * Runs synchronously before React hydrates.
 *
 * Behavior:
 *   - stored === 'light' → light
 *   - stored === 'dark'  → dark
 *   - stored === 'system' → follow prefers-color-scheme
 *   - no stored value    → dark (dark-first first-visit default)
 */
export const THEME_SCRIPT = `
(function(){
  try {
    var stored = localStorage.getItem('oth-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved;
    if (stored === 'light') {
      resolved = 'light';
    } else if (stored === 'dark') {
      resolved = 'dark';
    } else if (stored === 'system') {
      resolved = prefersDark ? 'dark' : 'light';
    } else {
      // No stored preference: dark-first default
      resolved = 'dark';
    }
    if (resolved === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  } catch(e) {
    document.documentElement.classList.add('dark');
  }
})();
`.trim();
