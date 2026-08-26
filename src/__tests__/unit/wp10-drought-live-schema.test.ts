import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  selectGibsDomainDate,
  inspectGibsPng,
  normalizeUsdmPercentArea,
} from "@/lib/drought/live-schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makePng(options: {
  width?: number;
  height?: number;
  alpha?: number;
  r?: number;
  g?: number;
  b?: number;
}): Promise<Uint8Array> {
  const { width = 256, height = 256, alpha = 255, r = 180, g = 90, b = 30 } = options;
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha: alpha / 255 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// 1. selectGibsDomainDate: fixed interval selects 2024-05-24 for 2024-06-04
// ---------------------------------------------------------------------------

describe("selectGibsDomainDate", () => {
  const INTERVAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Capabilities>
  <Layer>
    <Dimension name="time">
      <DimensionDomain>2024-05-08/2024-06-25/P16D</DimensionDomain>
    </Dimension>
  </Layer>
</Capabilities>`;

  it("fixed interval selects 2024-05-24 for 2024-06-04", () => {
    const result = selectGibsDomainDate(INTERVAL_XML, "2024-06-04");
    expect(result.selectedDate).toBe("2024-05-24");
    expect(result.declaredDates).toContain("2024-05-08");
    expect(result.declaredDates).toContain("2024-05-24");
  });

  // 2. Namespace/whitespace/order/comma harmless variations
  it("handles namespace prefix on DimensionDomain", () => {
    const xml = `<root><ows:DimensionDomain>2024-05-08/2024-06-25/P16D</ows:DimensionDomain></root>`;
    const result = selectGibsDomainDate(xml, "2024-06-04");
    expect(result.selectedDate).toBe("2024-05-24");
  });

  it("handles extra whitespace around content", () => {
    const xml = `<root><DimensionDomain>  2024-05-08/2024-06-25/P16D  </DimensionDomain></root>`;
    const result = selectGibsDomainDate(xml, "2024-06-04");
    expect(result.selectedDate).toBe("2024-05-24");
  });

  it("handles comma-separated dates in content", () => {
    const xml = `<root><DimensionDomain>2024-05-08, 2024-05-24, 2024-06-09, 2024-06-25</DimensionDomain></root>`;
    const result = selectGibsDomainDate(xml, "2024-06-04");
    expect(result.selectedDate).toBe("2024-05-24");
  });

  it("combines standalone dates and intervals regardless of element order", () => {
    const standaloneFirst = `<root>
      <DimensionDomain>2024-05-08</DimensionDomain>
      <Other harmless="true" />
      <ows:DimensionDomain>2024-05-24/2024-06-25/P16D</ows:DimensionDomain>
    </root>`;
    const intervalFirst = `<root>
      <ows:DimensionDomain>2024-05-24/2024-06-25/P16D</ows:DimensionDomain>
      <DimensionDomain>2024-05-08</DimensionDomain>
    </root>`;

    expect(selectGibsDomainDate(standaloneFirst, "2024-06-04")).toEqual(
      selectGibsDomainDate(intervalFirst, "2024-06-04")
    );
    expect(selectGibsDomainDate(standaloneFirst, "2024-06-04")).toMatchObject({
      declaredDates: ["2024-05-08", "2024-05-24", "2024-06-09", "2024-06-25"],
      selectedDate: "2024-05-24",
    });
  });

  it("returns null selectedDate when no dates are present", () => {
    const xml = `<root><DimensionDomain></DimensionDomain></root>`;
    const result = selectGibsDomainDate(xml, "2024-06-04");
    expect(result.selectedDate).toBeNull();
    expect(result.declaredDates).toHaveLength(0);
  });

  it("returns null selectedDate when no date <= requestedDate", () => {
    const xml = `<root><DimensionDomain>2024-06-09/2024-06-25/P16D</DimensionDomain></root>`;
    const result = selectGibsDomainDate(xml, "2024-06-04");
    expect(result.selectedDate).toBeNull();
    expect(result.declaredDates.length).toBeGreaterThan(0);
  });

  it("no DimensionDomain element returns empty selection", () => {
    const xml = `<root><Other>2024-05-08</Other></root>`;
    const result = selectGibsDomainDate(xml, "2024-06-04");
    expect(result.selectedDate).toBeNull();
    expect(result.declaredDates).toHaveLength(0);
  });

  it("rejects malformed XML instead of treating it as no observation", () => {
    expect(() =>
      selectGibsDomainDate("<bad interval '...'>", "2024-06-04")
    ).toThrow();
    expect(() =>
      selectGibsDomainDate(
        "<root><DimensionDomain>2024-05-08</wrong></root>",
        "2024-06-04"
      )
    ).toThrow();
  });

  // 3. Invalid period/date/reachability/limit/conflict failures
  it("rejects non-P16D period", () => {
    const xml = `<root><DimensionDomain>2024-05-08/2024-06-25/P8D</DimensionDomain></root>`;
    expect(() => selectGibsDomainDate(xml, "2024-06-04")).toThrow();
  });

  it("rejects interval where end is not reachable from start in 16-day steps", () => {
    // Start 2024-05-08, period P16D -> next would be 2024-05-24, but end is 2024-05-25
    const xml = `<root><DimensionDomain>2024-05-08/2024-05-25/P16D</DimensionDomain></root>`;
    expect(() => selectGibsDomainDate(xml, "2024-06-04")).toThrow();
  });

  it("rejects impossible dates", () => {
    const xml = `<root><DimensionDomain>2024-02-30/2024-03-15/P16D</DimensionDomain></root>`;
    expect(() => selectGibsDomainDate(xml, "2024-06-04")).toThrow();
  });

  it("handles expanded dates exceeding 256 limit from large interval", () => {
    // More than 256 dates: 16-day steps for 12 years = ~273 dates
    const xml = `<root><DimensionDomain>2010-01-01/2022-01-01/P16D</DimensionDomain></root>`;
    expect(() => selectGibsDomainDate(xml, "2022-01-01")).toThrow();
  });

  // 4. valid nontransparent 256 PNG and transparent-null result
  it("inspectGibsPng: returns inspection for opaque PNG", async () => {
    const bytes = await makePng({ alpha: 255, r: 100, g: 150, b: 200 });
    const result = await inspectGibsPng(bytes, "image/png");
    expect(result).not.toBeNull();
    expect(result?.contentType).toBe("image/png");
    expect(result?.imageWidth).toBe(256);
    expect(result?.imageHeight).toBe(256);
    expect(result?.opaqueSampleCount).toBeGreaterThan(0);
    expect(result?.distinctColorCount).toBeGreaterThan(0);
  });

  it("inspectGibsPng: returns null for fully transparent PNG", async () => {
    const bytes = await makePng({ alpha: 0 });
    const result = await inspectGibsPng(bytes, "image/png");
    expect(result).toBeNull();
  });

  // 5. wrong PNG/media/dimensions failures
  it("inspectGibsPng: throws on wrong media type", async () => {
    const bytes = await makePng({});
    await expect(inspectGibsPng(bytes, "image/jpeg")).rejects.toThrow();
  });

  it("inspectGibsPng: throws on wrong dimensions (128x128)", async () => {
    const bytes = await makePng({ width: 128, height: 128 });
    await expect(inspectGibsPng(bytes, "image/png")).rejects.toThrow();
  });

  it("inspectGibsPng: throws on non-PNG bytes", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG header
    await expect(inspectGibsPng(bytes, "image/png")).rejects.toThrow();
  });

  it("inspectGibsPng: accepts content-type with parameters", async () => {
    const bytes = await makePng({ alpha: 200 });
    const result = await inspectGibsPng(bytes, "image/png; charset=utf-8");
    expect(result).not.toBeNull();
  });

  // 6. Observed USDM schema and every locked alias/date/numeric form
  const VALID_USDM_ROW = {
    mapDate: "6/4/2024",
    stateAbbreviation: "AZ",
    none: 28.64,
    d0: 71.36,
    d1: 20.02,
    d2: 3.15,
    d3: 0,
    d4: 0,
    validStart: "6/4/2024",
    validEnd: "6/10/2024",
    statisticFormatID: 1,
  };

  it("normalizes observed USDM schema from live feasibility", () => {
    const result = normalizeUsdmPercentArea([VALID_USDM_ROW], "2024-06-04");
    expect(result).not.toBeNull();
    expect(result?.mapDate).toBe("2024-06-04");
    expect(result?.stateAbbreviation).toBe("AZ");
    expect(result?.nonePct).toBeCloseTo(28.64);
    expect(result?.d0Pct).toBeCloseTo(71.36);
    expect(result?.statisticFormatId).toBe(1);
  });

  it("accepts map_date alias", () => {
    const row = { ...VALID_USDM_ROW };
    // @ts-expect-error testing alias
    delete row.mapDate;
    // @ts-expect-error testing alias
    row.map_date = "6/4/2024";
    const result = normalizeUsdmPercentArea([row], "2024-06-04");
    expect(result).not.toBeNull();
  });

  it("accepts state_abbreviation alias", () => {
    const row = { ...VALID_USDM_ROW };
    // @ts-expect-error testing alias
    delete row.stateAbbreviation;
    // @ts-expect-error testing alias
    row.state_abbreviation = "AZ";
    const result = normalizeUsdmPercentArea([row], "2024-06-04");
    expect(result).not.toBeNull();
  });

  it("accepts statistic_format_id alias", () => {
    const row = {
      mapDate: "6/4/2024",
      stateAbbreviation: "AZ",
      none: 28.64,
      d0: 71.36,
      d1: 20.02,
      d2: 3.15,
      d3: 0,
      d4: 0,
      validStart: "6/4/2024",
      validEnd: "6/10/2024",
      statistic_format_id: 1,
    };
    const result = normalizeUsdmPercentArea([row], "2024-06-04");
    expect(result).not.toBeNull();
  });

  it("accepts valid_start / valid_end aliases", () => {
    const row = {
      mapDate: "6/4/2024",
      stateAbbreviation: "AZ",
      none: 28.64,
      d0: 71.36,
      d1: 20.02,
      d2: 3.15,
      d3: 0,
      d4: 0,
      valid_start: "6/4/2024",
      valid_end: "6/10/2024",
      statisticFormatID: 1,
    };
    const result = normalizeUsdmPercentArea([row], "2024-06-04");
    expect(result).not.toBeNull();
  });

  it("accepts compact YYYYMMDD date format", () => {
    const row = { ...VALID_USDM_ROW, mapDate: "20240604" };
    const result = normalizeUsdmPercentArea([row], "2024-06-04");
    expect(result).not.toBeNull();
  });

  it("accepts YYYY-MM-DD date format", () => {
    const row = { ...VALID_USDM_ROW, mapDate: "2024-06-04" };
    const result = normalizeUsdmPercentArea([row], "2024-06-04");
    expect(result).not.toBeNull();
  });

  it("accepts .NET /Date(ms)/ format for mapDate", () => {
    // 2024-06-04 = 1717459200000 ms UTC
    const ms = Date.UTC(2024, 5, 4); // June 4, 2024
    const row = { ...VALID_USDM_ROW, mapDate: `/Date(${ms})/` };
    const result = normalizeUsdmPercentArea([row], "2024-06-04");
    expect(result).not.toBeNull();
    expect(result?.mapDate).toBe("2024-06-04");
  });

  it("accepts numeric fields as canonical decimal strings", () => {
    const row = {
      ...VALID_USDM_ROW,
      none: "28.64",
      d0: "71.36",
      d1: "20.02",
      d2: "3.15",
      d3: "0",
      d4: "0",
    };
    const result = normalizeUsdmPercentArea([row], "2024-06-04");
    expect(result).not.toBeNull();
    expect(result?.nonePct).toBeCloseTo(28.64);
  });

  // 7. Harmless extra metadata
  it("ignores extra metadata fields not in alias list", () => {
    const row = { ...VALID_USDM_ROW, extraField: "ignored", someOtherField: 42 };
    const result = normalizeUsdmPercentArea([row], "2024-06-04");
    expect(result).not.toBeNull();
  });

  // 8. Zero/duplicate/conflicting target rows
  it("returns null for zero matching rows", () => {
    const result = normalizeUsdmPercentArea([VALID_USDM_ROW], "2024-06-11");
    expect(result).toBeNull();
  });

  it("throws for duplicate matching rows", () => {
    expect(() =>
      normalizeUsdmPercentArea([VALID_USDM_ROW, VALID_USDM_ROW], "2024-06-04")
    ).toThrow();
  });

  it("throws for conflicting values in both spellings", () => {
    const row = {
      ...VALID_USDM_ROW,
      map_date: "6/11/2024", // conflicts with mapDate: "6/4/2024"
    };
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });

  it("accepts both spellings when their normalized values match", () => {
    const row = {
      ...VALID_USDM_ROW,
      map_date: "2024-06-04T00:00:00Z",
      state_abbreviation: " az ",
      valid_start: "20240604",
      valid_end: "2024-06-10T00:00:00+00:00",
      statistic_format_id: "1",
    };
    expect(normalizeUsdmPercentArea([row], "2024-06-04")).toMatchObject({
      mapDate: "2024-06-04",
      stateAbbreviation: "AZ",
      validStart: "2024-06-04",
      validEnd: "2024-06-10",
      statisticFormatId: 1,
    });
  });

  it("rejects junk after an ISO date and accepts a real ISO timestamp", () => {
    expect(() =>
      normalizeUsdmPercentArea(
        [{ ...VALID_USDM_ROW, mapDate: "2024-06-04Tnot-a-time" }],
        "2024-06-04"
      )
    ).toThrow();

    expect(
      normalizeUsdmPercentArea(
        [{ ...VALID_USDM_ROW, mapDate: "2024-06-04T00:00:00.000Z" }],
        "2024-06-04"
      )?.mapDate
    ).toBe("2024-06-04");
  });

  it("rejects non-array payload", () => {
    expect(() => normalizeUsdmPercentArea({}, "2024-06-04")).toThrow();
    expect(() => normalizeUsdmPercentArea("string", "2024-06-04")).toThrow();
    expect(() => normalizeUsdmPercentArea(null, "2024-06-04")).toThrow();
  });

  // 9. Every percentage/identity/order failure
  it("rejects none percentage out of [0,100]", () => {
    const row = { ...VALID_USDM_ROW, none: -1, d0: 101 };
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });

  it("rejects identity violation (none + d0 != 100)", () => {
    const row = { ...VALID_USDM_ROW, none: 50, d0: 60 }; // 50+60=110
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });

  it("rejects ordering violation d1 > d0", () => {
    const row = { ...VALID_USDM_ROW, none: 28.64, d0: 71.36, d1: 72, d2: 3.15, d3: 0, d4: 0 };
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });

  it("rejects ordering violation d2 > d1", () => {
    const row = { ...VALID_USDM_ROW, d1: 5, d2: 10 };
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });

  it("rejects ordering violation d3 > d2", () => {
    const row = { ...VALID_USDM_ROW, d2: 3, d3: 5, d4: 0 };
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });

  it("rejects ordering violation d4 > d3", () => {
    const row = { ...VALID_USDM_ROW, d3: 2, d4: 5 };
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });

  it("rejects numeric field with exponent notation", () => {
    const row = { ...VALID_USDM_ROW, none: "2.864e1" };
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });

  it("rejects numeric field with percent sign", () => {
    const row = { ...VALID_USDM_ROW, none: "28.64%" };
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });

  it("rejects numeric field with commas", () => {
    const row = { ...VALID_USDM_ROW, d0: "71,36" };
    expect(() => normalizeUsdmPercentArea([row], "2024-06-04")).toThrow();
  });
});
