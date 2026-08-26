import { expect, type Page } from "@playwright/test";

/**
 * Navigate and wait for the post-hydration marker set by an effect in
 * src/components/shell/app-shell.tsx. React drops input events dispatched
 * before hydration finishes, so specs must not interact with the page until
 * this attribute appears.
 */
export async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-app-hydrated", "true", {
    timeout: 15_000,
  });
}
