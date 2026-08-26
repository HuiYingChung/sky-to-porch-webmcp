/**
 * ADR-0050: the Sky to Porch mark and its favicon variant.
 */

import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkyToPorchMark } from "@/components/brand/sky-to-porch-mark";

const ICON_PATH = join(process.cwd(), "src", "app", "icon.svg");

describe("ADR-0050 brand mark", () => {
  it("draws in currentColor so one file serves both themes", () => {
    const html = renderToStaticMarkup(<SkyToPorchMark />);
    expect(html).toContain("currentColor");
    // A hard-coded ink or ground colour would break one of the two themes.
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/iu);
  });

  it("is decorative by default and nameable when it stands alone", () => {
    const decorative = renderToStaticMarkup(<SkyToPorchMark />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain("role=\"img\"");

    const labelled = renderToStaticMarkup(<SkyToPorchMark title="Sky to Porch" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Sky to Porch"');
    expect(labelled).not.toContain('aria-hidden="true"');
  });

  it("renders at the requested size without distorting the artwork", () => {
    const html = renderToStaticMarkup(<SkyToPorchMark size={26} />);
    expect(html).toContain('width="26"');
    expect(html).toContain('height="26"');
    // The viewBox is the artwork's coordinate space and must stay square.
    expect(html).toContain('viewBox="0 0 64 64"');
  });
});

describe("ADR-0050 favicon", () => {
  const source = readFileSync(ICON_PATH, "utf8");
  // Assert against the markup, not the comments that explain it.
  const icon = source.replace(/<!--[\s\S]*?-->/gu, "");

  it("carries an explicit colour, because a standalone icon inherits none", () => {
    expect(icon).toContain("#4493f8");
    expect(icon).not.toContain("currentColor");
  });

  it("is redrawn heavier than the header mark so it survives 16px", () => {
    const strokeWidths = [...icon.matchAll(/stroke-width="([\d.]+)"/gu)]
      .map((match) => Number(match[1]));
    expect(strokeWidths.length).toBeGreaterThan(0);
    // The header mark's lightest stroke is 2.5 in the same 64-unit space.
    expect(Math.min(...strokeWidths)).toBeGreaterThan(2.5);
    // Two bars, not the header mark's three: three mush together at 16px.
    expect([...icon.matchAll(/<rect /gu)]).toHaveLength(2);
  });

  it("keeps the same square coordinate space as the header mark", () => {
    expect(icon).toContain('viewBox="0 0 64 64"');
  });
});
