import sharp from "sharp";
import { XMLValidator } from "fast-xml-parser";
import { assert } from "@/contracts/common";

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface GibsDomainSelection {
  declaredDates: string[];
  selectedDate: string | null;
}

export interface GibsPngInspection {
  contentType: "image/png";
  imageWidth: 256;
  imageHeight: 256;
  byteLength: number;
  opaqueSampleCount: number;
  distinctColorCount: number;
}

export interface UsdmPercentAreaRow {
  mapDate: string;
  stateAbbreviation: string;
  nonePct: number;
  d0Pct: number;
  d1Pct: number;
  d2Pct: number;
  d3Pct: number;
  d4Pct: number;
  validStart: string;
  validEnd: string;
  statisticFormatId: 1;
}

// ---------------------------------------------------------------------------
// Date validation helper
// ---------------------------------------------------------------------------

function assertStrictDate(value: string, label: string): void {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), `${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  assert(
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value,
    `${label} must be a real UTC calendar date`
  );
}

// ---------------------------------------------------------------------------
// selectGibsDomainDate
// ---------------------------------------------------------------------------

export function selectGibsDomainDate(
  xml: string,
  requestedDate: string
): GibsDomainSelection {
  assertStrictDate(requestedDate, "requestedDate");
  assert(typeof xml === "string" && xml.length > 0, "GIBS domain XML must be non-empty");
  assert(XMLValidator.validate(xml) === true, "GIBS domain XML must be well formed");

  // Extract all DimensionDomain element text contents, ignoring namespace prefix
  const domainPattern = /<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?DimensionDomain)\b[^>]*>([\s\S]*?)<\/\1\s*>/gu;
  const allTokens: string[] = [];

  let domainMatch: RegExpExecArray | null;
  while ((domainMatch = domainPattern.exec(xml)) !== null) {
    const content = domainMatch[2].replace(/<[^>]*>/gu, " ");
    // Split on whitespace and commas
    const rawTokens = content.split(/[\s,]+/).filter((t) => t.length > 0);
    allTokens.push(...rawTokens);
  }

  // No DimensionDomain found: return empty
  if (allTokens.length === 0) {
    return { declaredDates: [], selectedDate: null };
  }

  // Separate tokens into dates, start/end, and period
  const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
  const intervalRe = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})\/(P16D)$/;

  const expandedDates = new Set<string>();
  let startToken: string | null = null;
  let endToken: string | null = null;
  let periodToken: string | null = null;

  for (const token of allTokens) {
    // Reject any period-like token that is NOT exactly P16D (standalone or in interval)
    // Check standalone period first
    if (/^P[0-9]/.test(token) && !token.includes("/") && token !== "P16D") {
      assert(false, `rejected non-P16D period token: ${token}`);
    }

    // Check for interval syntax: start/end/P16D
    const intervalMatch = intervalRe.exec(token);
    if (intervalMatch) {
      const [, iStart, iEnd, iPeriod] = intervalMatch;
      // Validate period is exactly P16D (already enforced by regex)
      assert(iPeriod === "P16D", `interval period must be P16D, got ${iPeriod}`);
      // Validate dates
      assertStrictDate(iStart, "interval start");
      assertStrictDate(iEnd, "interval end");
      assert(iStart <= iEnd, "interval start must not be after end");
      if (startToken !== null) expandedDates.add(startToken);
      if (endToken !== null) expandedDates.add(endToken);
      startToken = null;
      endToken = null;
      periodToken = null;

      const startMs = Date.parse(`${iStart}T00:00:00Z`);
      const endMs = Date.parse(`${iEnd}T00:00:00Z`);
      const stepMs = 16 * 24 * 60 * 60 * 1000;
      let current = startMs;
      let lastExpanded = "";
      while (current <= endMs) {
        lastExpanded = new Date(current).toISOString().slice(0, 10);
        expandedDates.add(lastExpanded);
        assert(expandedDates.size <= 256, "expanded dates exceed limit of 256");
        current += stepMs;
      }
      assert(
        lastExpanded === iEnd,
        `interval end ${iEnd} is not reachable from ${iStart} in 16-day UTC steps`
      );
      continue;
    }

    // Check for start/end/period as separate tokens
    if (token === "P16D") {
      if (periodToken !== null) {
        assert(periodToken === "P16D", "conflicting period tokens");
      }
      periodToken = "P16D";
      continue;
    }

    // Reject any other non-P16D period-like token (slash-separated intervals with wrong period)
    // These would be things like "2024-05-08/2024-06-25/P8D" which didn't match intervalRe
    if (token.includes("/")) {
      // slash-separated token that didn't match interval regex -> reject
      assert(false, `rejected malformed or non-P16D interval token: ${token}`);
    }

    if (isoDateRe.test(token)) {
      // Could be an ISO date — validate it
      assertStrictDate(token, `date token ${token}`);
      // Check if it's the start or end of an interval, or a standalone date
      if (startToken === null && endToken === null) {
        // First date token: could be interval start or standalone
        startToken = token;
      } else if (startToken !== null && endToken === null) {
        // Second date token before a period: this is the interval end
        endToken = token;
      } else {
        // Standalone expanded date or additional date
        expandedDates.add(token);
      }
      continue;
    }

    // Any other non-date, non-period token is ignored (harmless attributes/elements covered by regex)
  }

  // If we have start/end/period, expand the 16-day interval
  if (startToken !== null && endToken !== null && periodToken !== null) {
    assert(startToken <= endToken, "interval start must not be after end");
    // Expand from start in 16-day UTC steps
    const startMs = Date.parse(`${startToken}T00:00:00Z`);
    const endMs = Date.parse(`${endToken}T00:00:00Z`);
    assert(Number.isFinite(startMs) && Number.isFinite(endMs), "interval dates must be real");

    const stepMs = 16 * 24 * 60 * 60 * 1000;
    let current = startMs;
    const expanded: string[] = [];
    while (current <= endMs) {
      const d = new Date(current).toISOString().slice(0, 10);
      expanded.push(d);
      current += stepMs;
    }
    // Verify the end is reachable
    assert(
      expanded[expanded.length - 1] === endToken,
      `interval end ${endToken} is not reachable from ${startToken} in 16-day UTC steps`
    );
    for (const d of expanded) expandedDates.add(d);
  } else if (startToken !== null && endToken === null && periodToken === null) {
    // Single date token without interval
    expandedDates.add(startToken);
  } else if (startToken !== null && endToken !== null && periodToken === null) {
    // start and end without period — just add both as dates
    expandedDates.add(startToken);
    expandedDates.add(endToken);
  } else if (startToken !== null && endToken === null && periodToken !== null) {
    // period without end — invalid
    assert(false, "interval period present without end date");
  }

  // Enforce limit
  assert(expandedDates.size <= 256, "expanded dates exceed limit of 256");

  // Sort and deduplicate
  const declaredDates = [...expandedDates].sort();

  // Find the greatest date <= requestedDate
  let selectedDate: string | null = null;
  for (const d of declaredDates) {
    if (d <= requestedDate) selectedDate = d;
    else break;
  }

  return { declaredDates, selectedDate };
}

// ---------------------------------------------------------------------------
// inspectGibsPng
// ---------------------------------------------------------------------------

export async function inspectGibsPng(
  bytes: Uint8Array,
  contentType: string
): Promise<GibsPngInspection | null> {
  // Normalize content type: strip parameters, lowercase
  const normalizedType = contentType.split(";", 1)[0].trim().toLowerCase();

  // Only normalize image/png
  if (normalizedType !== "image/png") {
    throw new Error(`schema_validation: expected image/png, got ${contentType}`);
  }

  let width: number | undefined;
  let height: number | undefined;
  let format: string | undefined;
  let sample: Buffer;
  try {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    width = metadata.width;
    height = metadata.height;
    format = metadata.format;
    sample = await sharp(bytes, { failOn: "error" })
      .resize(16, 16, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();
  } catch {
    throw new Error("schema_validation: PNG decode failed");
  }

  if (format !== "png" || width !== 256 || height !== 256 || sample.length !== 1024) {
    throw new Error("schema_validation: PNG must be 256x256 image/png");
  }

  let opaqueSampleCount = 0;
  const colors = new Set<string>();
  for (let index = 0; index < sample.length; index += 4) {
    const alpha = sample[index + 3];
    if (alpha === undefined || alpha === 0) continue;
    opaqueSampleCount += 1;
    const r = sample[index];
    const g = sample[index + 1];
    const b = sample[index + 2];
    colors.add(`${r},${g},${b},${alpha}`);
  }

  if (opaqueSampleCount === 0) return null;

  return {
    contentType: "image/png",
    imageWidth: 256,
    imageHeight: 256,
    byteLength: bytes.byteLength,
    opaqueSampleCount,
    distinctColorCount: colors.size,
  };
}

// ---------------------------------------------------------------------------
// normalizeUsdmPercentArea
// ---------------------------------------------------------------------------

// Canonical decimal string pattern: digits, optional decimal point, more digits, no exponent/commas/percent
const CANONICAL_DECIMAL_RE = /^-?\d+(\.\d+)?$/;

function parseNumericField(value: unknown, label: string): number {
  if (typeof value === "number") {
    assert(Number.isFinite(value), `${label} must be a finite number`);
    return value;
  }
  if (typeof value === "string") {
    assert(CANONICAL_DECIMAL_RE.test(value), `${label} must be a canonical decimal string`);
    const n = Number(value);
    assert(Number.isFinite(n), `${label} must be a finite number`);
    return n;
  }
  assert(false, `${label} must be a number or canonical decimal string`);
}

function normalizeDateField(raw: string): string {
  // Try YYYY-MM-DD, optionally followed by a complete ISO time and timezone.
  const isoRe = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?)?$/;
  const isoMatch = isoRe.exec(raw);
  if (isoMatch) {
    const candidate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    assertStrictDate(candidate, "date field");
    if (isoMatch[4] === undefined) return candidate;
    const parseable = isoMatch[7] === undefined ? `${raw}Z` : raw;
    const instant = Date.parse(parseable);
    assert(Number.isFinite(instant), "date field ISO timestamp must be valid");
    return new Date(instant).toISOString().slice(0, 10);
  }
  // Try M/D/YYYY (optionally with 12:00:00 AM)
  const mdyRe = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+12:00:00 AM)?$/;
  const mdyMatch = mdyRe.exec(raw);
  if (mdyMatch) {
    const m = mdyMatch[1].padStart(2, "0");
    const d = mdyMatch[2].padStart(2, "0");
    const y = mdyMatch[3];
    const candidate = `${y}-${m}-${d}`;
    assertStrictDate(candidate, "date field");
    return candidate;
  }
  // Try compact YYYYMMDD
  if (/^\d{8}$/.test(raw)) {
    const candidate = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    assertStrictDate(candidate, "date field");
    return candidate;
  }
  // Try .NET /Date(<ms>)/
  const dotnetRe = /^\/Date\((-?\d+)\)\/$/;
  const dotnetMatch = dotnetRe.exec(raw);
  if (dotnetMatch) {
    const ms = Number(dotnetMatch[1]);
    const d = new Date(ms);
    assert(!Number.isNaN(d.getTime()), "date field .NET ms must be valid");
    return d.toISOString().slice(0, 10);
  }
  assert(false, `date field has unrecognized format: ${raw}`);
}

// Field name aliases: canonical name -> accepted spellings (case-insensitive)
const FIELD_ALIASES: Array<[string, string[]]> = [
  ["mapDate", ["mapDate", "map_date"]],
  ["stateAbbreviation", ["stateAbbreviation", "state_abbreviation"]],
  ["none", ["none"]],
  ["d0", ["d0"]],
  ["d1", ["d1"]],
  ["d2", ["d2"]],
  ["d3", ["d3"]],
  ["d4", ["d4"]],
  ["validStart", ["validStart", "valid_start"]],
  ["validEnd", ["validEnd", "valid_end"]],
  ["statisticFormatId", ["statisticFormatID", "statistic_format_id"]],
];

function resolveFields(row: Record<string, unknown>): Record<string, unknown> {
  // Build canonical name -> value mapping using case-insensitive alias matching
  const result: Record<string, unknown> = {};
  const entries = Object.entries(row);

  const normalizeForComparison = (canonical: string, value: unknown): unknown => {
    if (["mapDate", "validStart", "validEnd"].includes(canonical)) {
      assert(typeof value === "string", `${canonical} must be a string`);
      return normalizeDateField(value);
    }
    if (canonical === "stateAbbreviation") {
      assert(typeof value === "string", "stateAbbreviation must be a string");
      return value.trim().toUpperCase();
    }
    if (["none", "d0", "d1", "d2", "d3", "d4", "statisticFormatId"].includes(canonical)) {
      return parseNumericField(value, canonical);
    }
    return value;
  };

  for (const [canonical, aliases] of FIELD_ALIASES) {
    const acceptedKeys = new Set(aliases.map((alias) => alias.toLowerCase()));
    const foundValues = entries
      .filter(([key]) => acceptedKeys.has(key.toLowerCase()))
      .map(([alias, value]) => ({ alias, value }));
    if (foundValues.length === 0) continue;
    if (foundValues.length === 1) {
      result[canonical] = foundValues[0].value;
      continue;
    }
    // Multiple spellings found — every spelling must have an equal canonical value.
    const normalizedValues = foundValues.map(({ value }) =>
      normalizeForComparison(canonical, value)
    );
    const first = normalizedValues[0];
    for (let index = 1; index < normalizedValues.length; index += 1) {
      assert(
        Object.is(first, normalizedValues[index]),
        `conflicting values for field ${canonical}: ${foundValues.map(({ value }) => String(value)).join(" vs ")}`
      );
    }
    result[canonical] = foundValues[0].value;
  }
  return result;
}

export function normalizeUsdmPercentArea(
  payload: unknown,
  requestedTuesday: string,
  expectedStateAbbreviation = "AZ"
): UsdmPercentAreaRow | null {
  assertStrictDate(requestedTuesday, "requestedTuesday");
  assert(
    /^[A-Z]{2}$/.test(expectedStateAbbreviation),
    "expectedStateAbbreviation must be a two-letter uppercase postal code"
  );

  assert(Array.isArray(payload), "USDM payload must be an array");

  const matchingRows: UsdmPercentAreaRow[] = [];

  for (const item of payload as unknown[]) {
    assert(
      typeof item === "object" && item !== null && !Array.isArray(item),
      "each USDM payload item must be a plain object"
    );
    const raw = item as Record<string, unknown>;
    const fields = resolveFields(raw);

    // Extract required fields
    const mapDateRaw = fields["mapDate"];
    const stateAbbreviationRaw = fields["stateAbbreviation"];
    const statisticFormatIdRaw = fields["statisticFormatId"];

    if (
      mapDateRaw === undefined ||
      stateAbbreviationRaw === undefined ||
      statisticFormatIdRaw === undefined
    ) {
      continue; // Skip rows without required fields
    }

    // Normalize map date
    assert(typeof mapDateRaw === "string", "mapDate must be a string");
    const mapDate = normalizeDateField(mapDateRaw);

    // Match the exact state or territory resolved for the canonical area.
    const stateAbbrev = typeof stateAbbreviationRaw === "string"
      ? stateAbbreviationRaw.trim().toUpperCase()
      : "";
    if (stateAbbrev !== expectedStateAbbreviation) continue;

    // Match map date to requestedTuesday
    if (mapDate !== requestedTuesday) continue;

    // Match format ID 1
    const formatId = parseNumericField(statisticFormatIdRaw, "statisticFormatId");
    if (formatId !== 1) continue;

    // Parse percentage fields
    const noneRaw = fields["none"];
    const d0Raw = fields["d0"];
    const d1Raw = fields["d1"];
    const d2Raw = fields["d2"];
    const d3Raw = fields["d3"];
    const d4Raw = fields["d4"];
    assert(noneRaw !== undefined, "USDM row missing 'none' field");
    assert(d0Raw !== undefined, "USDM row missing 'd0' field");
    assert(d1Raw !== undefined, "USDM row missing 'd1' field");
    assert(d2Raw !== undefined, "USDM row missing 'd2' field");
    assert(d3Raw !== undefined, "USDM row missing 'd3' field");
    assert(d4Raw !== undefined, "USDM row missing 'd4' field");

    const nonePct = parseNumericField(noneRaw, "none");
    const d0Pct = parseNumericField(d0Raw, "d0");
    const d1Pct = parseNumericField(d1Raw, "d1");
    const d2Pct = parseNumericField(d2Raw, "d2");
    const d3Pct = parseNumericField(d3Raw, "d3");
    const d4Pct = parseNumericField(d4Raw, "d4");

    // Validate each percentage in [0,100]
    for (const [name, pct] of [["none", nonePct], ["d0", d0Pct], ["d1", d1Pct], ["d2", d2Pct], ["d3", d3Pct], ["d4", d4Pct]] as Array<[string, number]>) {
      assert(
        Number.isFinite(pct) && pct >= 0 && pct <= 100,
        `USDM ${name} percentage must be in [0,100], got ${pct}`
      );
    }

    // Validate identity: abs(none + d0 - 100) <= 0.01
    assert(
      Math.abs(nonePct + d0Pct - 100) <= 0.01,
      `USDM none + d0 must equal 100 (tolerance 0.01); got ${nonePct} + ${d0Pct} = ${nonePct + d0Pct}`
    );

    // Validate ordering: d0 >= d1 >= d2 >= d3 >= d4 (tolerance 0.01)
    assert(d0Pct + 0.01 >= d1Pct, `USDM d0 must be >= d1 (tolerance 0.01); got ${d0Pct} < ${d1Pct}`);
    assert(d1Pct + 0.01 >= d2Pct, `USDM d1 must be >= d2 (tolerance 0.01); got ${d1Pct} < ${d2Pct}`);
    assert(d2Pct + 0.01 >= d3Pct, `USDM d2 must be >= d3 (tolerance 0.01); got ${d2Pct} < ${d3Pct}`);
    assert(d3Pct + 0.01 >= d4Pct, `USDM d3 must be >= d4 (tolerance 0.01); got ${d3Pct} < ${d4Pct}`);

    // Parse validStart and validEnd
    const validStartRaw = fields["validStart"];
    const validEndRaw = fields["validEnd"];
    assert(typeof validStartRaw === "string", "USDM validStart must be a string");
    assert(typeof validEndRaw === "string", "USDM validEnd must be a string");
    const validStart = normalizeDateField(validStartRaw);
    const validEnd = normalizeDateField(validEndRaw);

    matchingRows.push({
      mapDate,
      stateAbbreviation: expectedStateAbbreviation,
      nonePct,
      d0Pct,
      d1Pct,
      d2Pct,
      d3Pct,
      d4Pct,
      validStart,
      validEnd,
      statisticFormatId: 1,
    });
  }

  if (matchingRows.length === 0) return null;
  assert(matchingRows.length === 1, `USDM payload must contain exactly one matching row; found ${matchingRows.length}`);

  return matchingRows[0];
}
