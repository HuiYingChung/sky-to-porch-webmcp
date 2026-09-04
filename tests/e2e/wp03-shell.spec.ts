import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./helpers";

/**
 * WP-03 shell E2E tests (C01 revision).
 *
 * Covers all original WP-03 requirements plus C01 regression tests for:
 * - System theme under emulated OS preferences (light + dark)
 * - System theme live media change while running
 * - Theme selector synchronized across desktop/mobile after resize
 * - Query state preserved across desktop/mobile/desktop resize
 * - Unique document IDs and valid label/tab relationships
 * - Skip-link activation reaching the visible main content
 * - Computed text contrast (WCAG relative-luminance) for Dark and Light themes
 * - All original keyboard, responsive, truthfulness, and no-overflow behavior
 *
 * All tests are network-free and deterministic.
 * Filter with --grep "WP-03" or --grep "C01".
 */

// ── WCAG contrast helper (injected into page context) ─────────────────────────

/** Compute relative luminance for an sRGB hex color string (e.g. "rgb(30,33,40)"). */
const contrastScript = `
function relativeLuminance(r, g, b) {
  const cs = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * cs[0] + 0.7152 * cs[1] + 0.0722 * cs[2];
}
function contrastRatio(hex1, hex2) {
  function parseColor(c) {
    const m = c.match(/rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)/);
    if (m) return [+m[1], +m[2], +m[3]];
    const h = c.replace('#','');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  const [r1,g1,b1] = parseColor(hex1);
  const [r2,g2,b2] = parseColor(hex2);
  const L1 = relativeLuminance(r1,g1,b1);
  const L2 = relativeLuminance(r2,g2,b2);
  const lighter = Math.max(L1,L2);
  const darker  = Math.min(L1,L2);
  return (lighter + 0.05) / (darker + 0.05);
}
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fill the guided-query draft fields reachable from a given shell selector.
 * WP-04: place and time are owned by PlaceSelection (not QueryDraft).
 * This helper fills hazard, concern, and optional question.
 * For tests that need the evidence-answer CTA to be enabled, select a demo
 * place through the left Query controls that own canonical selection.
 */
async function fillQueryDraft(page: import("@playwright/test").Page, shellSelector: string) {
  const shell = page.locator(shellSelector);
  await shell.locator('[data-testid="hazard-select"]').selectOption("flood_storm");
  await shell.locator('[data-testid="concern-select"]').selectOption("home");
  await shell.locator('[data-testid="optional-question"]').fill("What changed this week?");
}

/**
 * Select a demo place via the non-map path in the visible map surface.
 * Required for isDraftSubmittable — placeSelection must be non-null.
 * Waits for the selection summary to confirm the selection is registered.
 */
async function selectDemoPlaceViaMap(page: import("@playwright/test").Page) {
  const mobileAsk = page.getByTestId("mobile-nav-ask");
  if (await mobileAsk.isVisible()) await mobileAsk.click();
  await page.getByTestId(/^(desktop|mobile)-gq-place-demo-houston$/)
    .filter({ visible: true })
    .click();
}

// ── Desktop layout ────────────────────────────────────────────────────────────

test.describe("WP-03 desktop shell", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("desktop shell is visible and has no horizontal overflow", async ({ page }) => {
    await gotoHydrated(page, "/");
    await expect(page.locator('[data-testid="desktop-shell"]')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test("guided query is visible on desktop", async ({ page }) => {
    await gotoHydrated(page, "/");
    await expect(page.locator('[data-testid="desktop-shell"]').locator('[data-testid="guided-query"]')).toBeVisible();
  });

  test("map area is visible on desktop", async ({ page }) => {
    await gotoHydrated(page, "/");
    await expect(page.locator('[data-testid="desktop-shell"]').locator('[data-testid="map-area"]')).toBeVisible();
  });

  test("insight navigation tabs are visible on desktop", async ({ page }) => {
    await gotoHydrated(page, "/");
    const ds = page.locator('[data-testid="desktop-shell"]');
    await expect(ds.locator('[data-testid="tab-meaning"]')).toHaveText("Meaning");
    await expect(ds.locator('[data-testid="tab-evidence"]')).toHaveText("Evidence");
    await expect(ds.locator('[data-testid="tab-missions"]')).toHaveText("Missions");
  });

  test("all Insight tabs start with purpose guidance only and no repeated selection summary", async ({ page }) => {
    await gotoHydrated(page, "/?dev=1");
    const ds = page.locator('[data-testid="desktop-shell"]');
    const meaning = ds.locator('[data-testid="panel-meaning"]');
    await expect(meaning.getByTestId("meaning-empty-prompt").locator("p").first())
      .toHaveText(
        "Meaning answers your question in plain English, grounded in validated observations, with clear limitations and useful next checks."
      );
    await expect(meaning.getByTestId("selection-summary")).toHaveCount(0);

    await ds.getByTestId("tab-evidence").click();
    const evidence = ds.getByTestId("panel-evidence");
    await expect(evidence.getByTestId("evidence-empty-prompt"))
      .toHaveText(
        "Evidence is the audit trail: the exact datasets, observation times, values, and limitations behind each answer, including any no-data state. Ask a question first to create a result."
      );
    await expect(evidence.getByTestId("selection-summary")).toHaveCount(0);

    await ds.getByTestId("tab-missions").click();
    const missions = ds.getByTestId("panel-missions");
    await expect(missions.getByTestId("missions-empty-prompt"))
      .toHaveText(
        "Missions gives background on the satellites, sensors, and agencies behind the evidence, with clearly labelled example imagery. Ask a question first to create a result."
      );
    await expect(missions.getByTestId("selection-summary")).toHaveCount(0);

    await ds.getByTestId("desktop-gq-place-demo-houston").click();
    await ds.getByTestId("tab-meaning").click();
    await expect(meaning.getByTestId("meaning-empty-prompt")).toBeVisible();
    await expect(meaning.getByTestId("selection-summary")).toHaveCount(0);
  });
});

// ── Mobile layout ─────────────────────────────────────────────────────────────

test.describe("WP-03 mobile shell", () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test("mobile shell is visible and has no horizontal overflow", async ({ page }) => {
    await gotoHydrated(page, "/");
    await expect(page.locator('[data-testid="mobile-shell"]')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test("Ask view shows guided query by default", async ({ page }) => {
    await gotoHydrated(page, "/");
    const ms = page.locator('[data-testid="mobile-shell"]');
    await expect(ms.locator('[data-testid="mobile-ask-view"]')).toBeVisible();
    await expect(ms.locator('[data-testid="guided-query"]')).toBeVisible();
  });

  test("Map nav button shows map placeholder", async ({ page }) => {
    await gotoHydrated(page, "/");
    const ms = page.locator('[data-testid="mobile-shell"]');
    await ms.locator('[data-testid="mobile-nav-map"]').click();
    await expect(ms.locator('[data-testid="mobile-map-view"]')).toBeVisible();
  });

  test("Insight nav button shows insight view", async ({ page }) => {
    await gotoHydrated(page, "/");
    const ms = page.locator('[data-testid="mobile-shell"]');
    await ms.locator('[data-testid="mobile-nav-insight"]').click();
    await expect(ms.locator('[data-testid="mobile-insight-view"]')).toBeVisible();
    await expect(ms.locator('[data-testid="tab-meaning"]')).toBeVisible();
  });

  test("mobile nav buttons are keyboard operable", async ({ page }) => {
    await gotoHydrated(page, "/");
    const ms = page.locator('[data-testid="mobile-shell"]');
    const mapBtn = ms.locator('[data-testid="mobile-nav-map"]');
    await mapBtn.focus();
    await page.keyboard.press("Enter");
    await expect(ms.locator('[data-testid="mobile-map-view"]')).toBeVisible();
  });
});

// ── C01: Unique IDs and valid label/tab relationships ─────────────────────────

test.describe("WP-03 C01 unique IDs and label relationships", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("document has exactly one element with id=main-content", async ({ page }) => {
    await gotoHydrated(page, "/");
    const count = await page.evaluate(
      () => document.querySelectorAll("#main-content").length
    );
    expect(count).toBe(1);
  });

  test("no duplicate IDs exist in the document", async ({ page }) => {
    await gotoHydrated(page, "/");
    const dupes = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll("[id]")).map(el => el.id);
      const seen = new Set<string>();
      const dupeList: string[] = [];
      for (const id of ids) {
        if (seen.has(id)) dupeList.push(id);
        seen.add(id);
      }
      return dupeList;
    });
    expect(dupes).toEqual([]);
  });

  test("each tab aria-controls references an existing panel element", async ({ page }) => {
    await gotoHydrated(page, "/");
    const broken = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      return tabs
        .map(t => t.getAttribute("aria-controls") ?? "")
        .filter(id => id && !document.getElementById(id))
        .join(", ");
    });
    expect(broken).toBe("");
  });

  test("each label htmlFor references an existing input/select element", async ({ page }) => {
    await gotoHydrated(page, "/");
    const broken = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("label[for]"));
      return labels
        .map(l => l.getAttribute("for") ?? "")
        .filter(id => id && !document.getElementById(id))
        .join(", ");
    });
    expect(broken).toBe("");
  });
});

// ── C01: Skip-link activation ─────────────────────────────────────────────────

test.describe("WP-03 C01 skip link (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("skip link is present and focusable", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
  });

  test("activating skip link targets #main-content", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.keyboard.press("Tab");   // focus skip link
    await page.keyboard.press("Enter"); // activate
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      const main = document.getElementById("main-content");
      return main ? (main === el || main.contains(el ?? null)) : false;
    });
    expect(focused).toBe(true);
  });
});

test.describe("WP-03 C01 skip link (mobile)", () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test("skip link is present and focusable", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
  });

  test("activating skip link targets the visible #main-content", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(page.locator('[data-testid="mobile-shell"]')).toBeVisible();
  });
});

// ── C01: Theme — System persisted and follows OS ──────────────────────────────

test.describe("WP-03 explicit theme controls", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("System control is removed", async ({ page }) => {
    await gotoHydrated(page, "/");
    const header = page.locator('[data-testid="app-header"]');
    await expect(header.locator('[data-testid="theme-btn-light"]')).toBeVisible();
    await expect(header.locator('[data-testid="theme-btn-dark"]')).toBeVisible();
    await expect(header.locator('[data-testid="theme-btn-system"]')).toHaveCount(0);
  });

  test("legacy System with dark OS migrates to explicit Dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => window.localStorage.setItem("oth-theme", "system"));
    await gotoHydrated(page, "/");
    const header = page.locator('[data-testid="app-header"]');
    await expect(header.locator('[data-testid="theme-btn-dark"]')).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("oth-theme"))).toBe("dark");
  });

  test("legacy System with light OS migrates to explicit Light", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => window.localStorage.setItem("oth-theme", "system"));
    await gotoHydrated(page, "/");
    const header = page.locator('[data-testid="app-header"]');
    await expect(header.locator('[data-testid="theme-btn-light"]')).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("oth-theme"))).toBe("light");
  });

  test("migrated Dark no longer follows a later OS change", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => window.localStorage.setItem("oth-theme", "system"));
    await gotoHydrated(page, "/");
    const root = page.locator("html");
    await expect(root).toHaveClass(/dark/);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("oth-theme")))
      .toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(root).toHaveClass(/dark/);
    await expect(root).not.toHaveClass(/light/);
  });

  test("migrated Light no longer follows a later OS change", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => window.localStorage.setItem("oth-theme", "system"));
    await gotoHydrated(page, "/");
    const root = page.locator("html");
    await expect(root).toHaveClass(/light/);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("oth-theme")))
      .toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(root).toHaveClass(/light/);
    await expect(root).not.toHaveClass(/dark/);
  });

  test("stored Light hydrates without a React mismatch", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => window.localStorage.setItem("oth-theme", "light"));
    await gotoHydrated(page, "/");
    await expect(
      page.locator('[data-testid="app-header"] [data-testid="theme-btn-light"]')
    ).toHaveAttribute("aria-pressed", "true");
    expect(errors.filter((message) => /hydration|did not match/i.test(message))).toEqual([]);
  });

  test("default Dark hydrates without a React mismatch", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await gotoHydrated(page, "/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(errors.filter((message) => /hydration|did not match/i.test(message))).toEqual([]);
  });
});

// ── Theme persistence (Light/Dark) ────────────────────────────────────────────

test.describe("WP-03 theme persistence Light/Dark", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Dark theme is applied by default (dark-first)", async ({ page }) => {
    await gotoHydrated(page, "/");
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  });

  test("Selecting Light theme removes dark class and adds light class", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.locator('[data-testid="app-header"]').locator('[data-testid="theme-btn-light"]').click();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.classList.contains("light"))).toBe(true);
  });

  test("Light choice survives reload", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.locator('[data-testid="app-header"]').locator('[data-testid="theme-btn-light"]').click();
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  });

  test("Dark choice survives reload", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.locator('[data-testid="app-header"]').locator('[data-testid="theme-btn-dark"]').click();
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  });

  test("theme buttons are keyboard operable", async ({ page }) => {
    await gotoHydrated(page, "/");
    const darkBtn = page.locator('[data-testid="app-header"]').locator('[data-testid="theme-btn-dark"]');
    await darkBtn.focus();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  });
});

// ── C01: Theme selector synchronized after resize ─────────────────────────────

test.describe("WP-03 C01 theme selector sync on resize", () => {
  test("theme aria-pressed is consistent in desktop and mobile headers after resize", async ({ page }) => {
    // Start at desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    // Select Light on desktop header
    await page.locator('[data-testid="app-header"]').locator('[data-testid="theme-btn-light"]').click();
    // Resize to mobile
    await page.setViewportSize({ width: 393, height: 851 });
    await page.waitForTimeout(50);
    // Mobile header's Light button should also be pressed
    await expect(
      page.locator('[data-testid="mobile-header"]').locator('[data-testid="theme-btn-light"]')
    ).toHaveAttribute("aria-pressed", "true");
    // Desktop Dark button should not be pressed
    await expect(
      page.locator('[data-testid="app-header"]').locator('[data-testid="theme-btn-dark"]')
    ).toHaveAttribute("aria-pressed", "false");
  });
});

// ── Query-state preservation across views and resize ─────────────────────────

test.describe("WP-03 query-state preservation (mobile)", () => {
  test.use({ viewport: { width: 393, height: 851 } });

  test("query draft is preserved when switching mobile views", async ({ page }) => {
    await gotoHydrated(page, "/");
    // WP-04: place/time owned by placeSelection; only hazard/concern/optionalQuestion in draft
    await fillQueryDraft(page, '[data-testid="mobile-shell"]');
    const ms = page.locator('[data-testid="mobile-shell"]');
    await ms.locator('[data-testid="mobile-nav-map"]').click();
    await expect(ms.locator('[data-testid="mobile-map-view"]')).toBeVisible();
    await ms.locator('[data-testid="mobile-nav-ask"]').click();
    await expect(ms.locator('[data-testid="hazard-select"]')).toHaveValue("flood_storm");
    await expect(ms.locator('[data-testid="concern-select"]')).toHaveValue("home");
  });
});

test.describe("WP-03 C01 query-state preserved across resize", () => {
  test("query values survive desktop→mobile→desktop viewport resize", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    // Fill query on desktop — WP-04: hazard/concern/optionalQuestion only in draft
    await fillQueryDraft(page, '[data-testid="desktop-shell"]');
    // Resize to mobile
    await page.setViewportSize({ width: 393, height: 851 });
    await page.waitForTimeout(50);
    // Hazard, concern, and optionalQuestion should be present in mobile shell
    const ms = page.locator('[data-testid="mobile-shell"]');
    await expect(ms.locator('[data-testid="hazard-select"]')).toHaveValue("flood_storm");
    await expect(ms.locator('[data-testid="concern-select"]')).toHaveValue("home");
    await expect(ms.locator('[data-testid="optional-question"]')).toHaveValue(
      "What changed this week?"
    );
    // Resize back to desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(50);
    const ds = page.locator('[data-testid="desktop-shell"]');
    await expect(ds.locator('[data-testid="hazard-select"]')).toHaveValue("flood_storm");
    await expect(ds.locator('[data-testid="concern-select"]')).toHaveValue("home");
    await expect(ds.locator('[data-testid="optional-question"]')).toHaveValue(
      "What changed this week?"
    );
  });
});

// ── Insight tab keyboard navigation ───────────────────────────────────────────

test.describe("WP-03 insight tab keyboard navigation", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("arrow keys navigate between insight tabs", async ({ page }) => {
    await gotoHydrated(page, "/");
    const ds = page.locator('[data-testid="desktop-shell"]');
    const meaningTab = ds.locator('[data-testid="tab-meaning"]');
    await meaningTab.focus();
    await expect(meaningTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(ds.locator('[data-testid="tab-evidence"]')).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(ds.locator('[data-testid="tab-missions"]')).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(meaningTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(ds.locator('[data-testid="tab-missions"]')).toHaveAttribute("aria-selected", "true");
  });

  test("tab panels show correct content", async ({ page }) => {
    await gotoHydrated(page, "/");
    const ds = page.locator('[data-testid="desktop-shell"]');
    await expect(ds.locator('[data-testid="panel-meaning"]')).toBeVisible();
    await expect(ds.locator('[data-testid="panel-evidence"]')).toBeHidden();
    await ds.locator('[data-testid="tab-evidence"]').click();
    await expect(ds.locator('[data-testid="panel-evidence"]')).toBeVisible();
    await expect(ds.locator('[data-testid="panel-meaning"]')).toBeHidden();
  });
});

// ── C01: Computed contrast assertions ────────────────────────────────────────

test.describe("WP-03 C01 contrast assertions", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /** Returns the contrast ratio between two computed colors (strings like "rgb(r, g, b)"). */
  async function getContrast(
    page: import("@playwright/test").Page,
    selector: string,
    fgProp: string,
    bgProp: string
  ): Promise<number> {
    return page.evaluate(
      ({ sel, fg, bg, script }) => {
        // eslint-disable-next-line no-eval
        eval(script);
        const el = document.querySelector(sel);
        if (!el) return 0;
        const style = getComputedStyle(el);
        const fgColor = style.getPropertyValue(fg).trim() || style.color;
        const bgColor = style.getPropertyValue(bg).trim() || style.backgroundColor;
        // @ts-ignore — contrastRatio defined by eval
        return contrastRatio(fgColor, bgColor);
      },
      { sel: selector, fg: fgProp, bg: bgProp, script: contrastScript }
    );
  }

  test("Dark theme: body text meets 4.5:1 on canvas background", async ({ page }) => {
    await gotoHydrated(page, "/");
    // Ensure dark mode
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    const ratio = await page.evaluate((script) => {
      // eslint-disable-next-line no-eval
      eval(script);
      const body = document.body;
      const style = getComputedStyle(body);
      const fg = style.color;
      const bg = style.backgroundColor;
      // @ts-ignore
      return contrastRatio(fg, bg);
    }, contrastScript);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test("Light theme: body text meets 4.5:1 on canvas background", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.locator('[data-testid="app-header"]').locator('[data-testid="theme-btn-light"]').click();
    const ratio = await page.evaluate((script) => {
      // eslint-disable-next-line no-eval
      eval(script);
      const body = document.body;
      const style = getComputedStyle(body);
      // @ts-ignore
      return contrastRatio(style.color, style.backgroundColor);
    }, contrastScript);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test("Dark theme: muted text token meets 4.5:1 on surface-1", async ({ page }) => {
    await gotoHydrated(page, "/");
    // Query the heading which uses --text-secondary (passes) vs muted note which uses --text-muted
    // We inspect the CSS variable values directly via a test element
    const ratio = await page.evaluate((script) => {
      // eslint-disable-next-line no-eval
      eval(script);
      const style = getComputedStyle(document.documentElement);
      const muted  = style.getPropertyValue("--text-muted").trim();
      const surface1 = style.getPropertyValue("--surface-1").trim();
      // @ts-ignore
      return contrastRatio(muted, surface1);
    }, contrastScript);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test("Light theme: muted text token meets 4.5:1 on surface-1", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.locator('[data-testid="app-header"]').locator('[data-testid="theme-btn-light"]').click();
    const ratio = await page.evaluate((script) => {
      // eslint-disable-next-line no-eval
      eval(script);
      const style = getComputedStyle(document.documentElement);
      const muted    = style.getPropertyValue("--text-muted").trim();
      const surface1 = style.getPropertyValue("--surface-1").trim();
      // @ts-ignore
      return contrastRatio(muted, surface1);
    }, contrastScript);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test("Dark theme: focus ring meets 3:1 on surface-1", async ({ page }) => {
    await gotoHydrated(page, "/");
    const ratio = await page.evaluate((script) => {
      // eslint-disable-next-line no-eval
      eval(script);
      const style = getComputedStyle(document.documentElement);
      const focus   = style.getPropertyValue("--focus-ring").trim();
      const surface1 = style.getPropertyValue("--surface-1").trim();
      // @ts-ignore
      return contrastRatio(focus, surface1);
    }, contrastScript);
    expect(ratio).toBeGreaterThanOrEqual(3.0);
  });

  test("Light theme: focus ring meets 3:1 on surface-1", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.locator('[data-testid="app-header"]').locator('[data-testid="theme-btn-light"]').click();
    const ratio = await page.evaluate((script) => {
      // eslint-disable-next-line no-eval
      eval(script);
      const style = getComputedStyle(document.documentElement);
      const focus    = style.getPropertyValue("--focus-ring").trim();
      const surface1 = style.getPropertyValue("--surface-1").trim();
      // @ts-ignore
      return contrastRatio(focus, surface1);
    }, contrastScript);
    expect(ratio).toBeGreaterThanOrEqual(3.0);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`${theme} theme: --text-muted on --canvas-bg-subtle meets 4.5:1`, async ({ page }) => {
      await page.addInitScript((storedTheme) => {
        window.localStorage.setItem("oth-theme", storedTheme);
      }, theme);
      await gotoHydrated(page, "/");
      const ratio = await page.evaluate((script) => {
        // eslint-disable-next-line no-eval
        eval(script);
        const root = document.documentElement;
        const style = getComputedStyle(root);
        const color = style.getPropertyValue("--text-muted").trim();
        const bg    = style.getPropertyValue("--canvas-bg-subtle").trim();
        if (!color || !bg) return 0;
        // @ts-ignore
        return contrastRatio(color, bg);
      }, contrastScript);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    test(`${theme} theme: visible form-control boundary meets 3:1`, async ({ page }) => {
      await page.addInitScript((storedTheme) => {
        window.localStorage.setItem("oth-theme", storedTheme);
      }, theme);
      await gotoHydrated(page, "/");
      const ratio = await page.evaluate((script) => {
        // eslint-disable-next-line no-eval
        eval(script);
        // WP-04: place-input removed; use hazard-select (always present in desktop shell)
        const input = document.querySelector(
          '[data-testid="desktop-shell"] [data-testid="hazard-select"]'
        );
        if (!input) return 0;
        const style = getComputedStyle(input);
        // @ts-ignore
        return contrastRatio(style.borderTopColor, style.backgroundColor);
      }, contrastScript);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });

    test(`${theme} theme: actual keyboard focus indicator meets 3:1`, async ({ page }) => {
      await page.addInitScript((storedTheme) => {
        window.localStorage.setItem("oth-theme", storedTheme);
      }, theme);
      await gotoHydrated(page, "/");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      const ratio = await page.evaluate((script) => {
        // eslint-disable-next-line no-eval
        eval(script);
        const focused = document.activeElement;
        const header = document.querySelector('[data-testid="app-header"]');
        if (!(focused instanceof HTMLElement) || !header) return 0;
        const focusedStyle = getComputedStyle(focused);
        const headerStyle = getComputedStyle(header);
        if (focusedStyle.outlineStyle === "none") return 0;
        // @ts-ignore
        return contrastRatio(focusedStyle.outlineColor, headerStyle.backgroundColor);
      }, contrastScript);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });
  }
});

// ── Truthfulness ──────────────────────────────────────────────────────────────

test.describe("WP-03 truthfulness — no fabricated content", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("insight panels contain no fabricated live results or alerts", async ({ page }) => {
    await gotoHydrated(page, "/");
    const ds = page.locator('[data-testid="desktop-shell"]');
    const text = (await ds.locator('[data-testid="panel-meaning"]').textContent()) ?? "";
    expect(text.toLowerCase()).not.toContain("alert");
    expect(text.toLowerCase()).not.toContain("evacuate");
    expect(text.toLowerCase()).not.toContain("detected today");
    expect(text.toLowerCase()).not.toContain("current fire");
  });

  test("Earth and Volcanoes keeps observed events separate from satellite meaning", async ({ page }) => {
    await gotoHydrated(page, "/");
    // WP-04: isDraftSubmittable requires placeSelection; select a demo place first
    await selectDemoPlaceViaMap(page);
    // Fill hazard and concern in the visible guided query (desktop or mobile, whichever is showing)
    const visibleGuidedQuery = page.getByTestId("guided-query").filter({ visible: true }).first();
    await visibleGuidedQuery.locator('[data-testid="hazard-select"]').selectOption("earth_volcanoes");
    // ADR-0044: the story card pre-filled a two-day Flood range; Earth &
    // Volcanoes takes one observation date, so pin it explicitly.
    await page.getByTestId(/^(desktop|mobile)-gq-custom-date$/)
      .filter({ visible: true }).fill("2026-08-13");
    await visibleGuidedQuery.locator('[data-testid="concern-select"]').selectOption("home");
    // Evidence-answer button in the visible guided query
    const findEvidenceBtn = page.getByTestId("find-evidence-btn").filter({ visible: true }).first();
    await expect(findEvidenceBtn).toBeEnabled();
    await findEvidenceBtn.click();
    const panel = page.getByTestId("coverage-gap-panel").filter({ visible: true }).first();
    await expect(panel).toBeVisible();
    const text = (await panel.textContent()) ?? "";
    expect(text.toLowerCase()).toContain("live retrieval · inconclusive evidence");
    expect(text.toLowerCase()).toContain("no meaningful satellite connection is claimed");
    // ADR-0045: earth joined the guarded explanation chain. In E2E the guard
    // always denies before any provider call (no env → "not configured";
    // real .env.local present → "abuse controls unconfigured" / origin
    // rejection), so accept any deterministic status but never an AI answer.
    expect(
      text.toLowerCase().includes("rule-based explanation") ||
        text.toLowerCase().includes("ai explanation is not configured")
    ).toBe(true);
    expect(text.toLowerCase()).not.toContain("explained by");
    expect(text.toLowerCase()).not.toContain("detected");
    expect(text.toLowerCase()).not.toContain("found evidence");
    await expect(page.getByTestId("not-connected-status")).toHaveCount(0);
  });

  test("one CTA submits the trimmed question and owns the loading semantics", async ({ page }) => {
    let requestBody: Record<string, unknown> | undefined;
    let releaseRoute: (() => void) | undefined;
    const routeRelease = new Promise<void>((resolve) => {
      releaseRoute = resolve;
    });
    await page.route("**/api/flood/query", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await routeRelease;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: { kind: "unsupported_place", rejectionReason: "deterministic test stub" },
        }),
      });
    });

    await gotoHydrated(page, "/");
    await selectDemoPlaceViaMap(page);
    const query = page.getByTestId("guided-query").filter({ visible: true }).first();
    await query.locator('[data-testid="hazard-select"]').selectOption("flood_storm");
    await query.locator('[data-testid="concern-select"]').selectOption("power_internet");
    await query.locator('[data-testid="optional-question"]').fill("  Is there any power outage?  ");

    await expect(query.getByTestId("interpret-question-btn")).toHaveCount(0);
    await expect(query.getByTestId("interpret-apply-btn")).toHaveCount(0);
    await expect(query.locator('button[type="submit"]')).toHaveCount(1);
    const button = query.getByTestId("find-evidence-btn");
    await expect(button).toHaveText("Get evidence-based answer");
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveText("Finding and explaining evidence…");
    await expect.poll(() => requestBody?.optionalQuestion).toBe("Is there any power outage?");

    releaseRoute?.();
    await expect(button).toHaveText("Get evidence-based answer");
  });
});
