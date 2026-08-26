#!/usr/bin/env node
/**
 * Manual WP-02 live-source verification.
 *
 * This script is intentionally excluded from deterministic tests and CI. It
 * performs bounded credential-free requests, validates each payload without a
 * fixture fallback, reports drift as failure, and keeps source outcomes
 * separate. A pass is local live-source evidence only.
 */

import { createHash } from "crypto";
import { XMLParser } from "fast-xml-parser";

const TIMEOUT_MS = 30_000;
const results = [];

const URLS = {
  hmsFire:
    "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/KML/2025/01/hms_fire20250108.kml",
  hmsSmoke:
    "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2025/01/hms_smoke20250108.kml",
  gibsMetadata:
    "https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/IMERG_Precipitation_Rate.json",
  usgs:
    "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=08074500&startDT=2024-07-08&endDT=2024-07-10&parameterCd=00065&siteStatus=all",
};

function gibsUrl(time) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    LAYERS: "IMERG_Precipitation_Rate",
    SRS: "EPSG:4326",
    STYLES: "",
    WIDTH: "512",
    HEIGHT: "512",
    TIME: time,
    BBOX: "-97,28,-94,31",
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

async function fetchBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { response, buffer };
  } finally {
    clearTimeout(timer);
  }
}

function addIssue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function report(sourceId, url, details, issues = []) {
  const status = issues.length === 0 ? "success" : "failure";
  const result = {
    ts: new Date().toISOString(),
    sourceId,
    status,
    url,
    ...details,
    issues,
  };
  results.push(result);
  console.log(`\n[${status === "success" ? "PASS" : "FAIL"}] ${sourceId}`);
  for (const [key, value] of Object.entries(result)) {
    if (["ts", "sourceId", "status", "url"].includes(key)) continue;
    console.log(`  ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return status === "success";
}

function reportFailure(sourceId, url, error) {
  return report(
    sourceId,
    url,
    { error: String(error) },
    ["Network, timeout, or payload-processing failure; no fixture fallback was used."]
  );
}

function collectCoordinateTexts(node, output) {
  if (Array.isArray(node)) {
    for (const item of node) collectCoordinateTexts(item, output);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "coordinates") {
      if (typeof value === "string") output.push(value);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") output.push(item);
          else collectCoordinateTexts(item, output);
        }
      } else {
        collectCoordinateTexts(value, output);
      }
    } else {
      collectCoordinateTexts(value, output);
    }
  }
}

function parseKmlCoordinatePairs(buffer) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(buffer.toString("utf8"));
  const coordinateTexts = [];
  collectCoordinateTexts(parsed, coordinateTexts);
  const pairs = [];
  for (const text of coordinateTexts) {
    for (const token of text.trim().split(/\s+/u)) {
      if (!token) continue;
      const parts = token.split(",");
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      if (
        parts.length < 2 ||
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        lon < -180 ||
        lon > 180 ||
        lat < -90 ||
        lat > 90
      ) {
        throw new Error(`Invalid KML coordinate token: ${token.slice(0, 80)}`);
      }
      pairs.push({ lon, lat });
    }
  }
  return pairs;
}

function countInBox(pairs, box) {
  return pairs.filter(
    ({ lon, lat }) =>
      lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north
  ).length;
}

async function checkHmsKml({
  sourceId,
  url,
  expectedBytes,
  expectedHash,
  expectedPairs,
  boxes,
}) {
  try {
    const { response, buffer } = await fetchBuffer(url);
    const issues = [];
    const contentType = response.headers.get("content-type") ?? "";
    const payloadHash = sha256(buffer);
    let pairs = [];
    try {
      pairs = parseKmlCoordinatePairs(buffer);
    } catch (error) {
      issues.push(`XML-aware KML parsing failed: ${String(error)}`);
    }
    addIssue(issues, response.ok, `HTTP status ${response.status}`);
    addIssue(issues, buffer.length === expectedBytes, `bytes drifted: ${buffer.length}`);
    addIssue(issues, payloadHash === expectedHash, `SHA-256 drifted: ${payloadHash}`);
    addIssue(issues, pairs.length === expectedPairs, `coordinate-pair count drifted: ${pairs.length}`);

    const boxCounts = {};
    for (const { name, box, expected } of boxes) {
      const actual = countInBox(pairs, box);
      boxCounts[name] = actual;
      addIssue(issues, actual === expected, `${name} count drifted: ${actual}`);
    }

    return report(
      sourceId,
      url,
      {
        httpStatus: response.status,
        contentType,
        bytes: buffer.length,
        sha256: payloadHash,
        coordinatePairs: pairs.length,
        boxCounts,
        parser: "fast-xml-parser",
      },
      issues
    );
  } catch (error) {
    return reportFailure(sourceId, url, error);
  }
}

async function checkGibsImage({ sourceId, time, expectedBytes, expectedHash }) {
  const url = gibsUrl(time);
  try {
    const { response, buffer } = await fetchBuffer(url);
    const issues = [];
    const contentType = response.headers.get("content-type") ?? "";
    const payloadHash = sha256(buffer);
    const pngSignature =
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    addIssue(issues, response.ok, `HTTP status ${response.status}`);
    addIssue(issues, contentType.toLowerCase().startsWith("image/png"), `unexpected content type: ${contentType}`);
    addIssue(issues, pngSignature, "PNG signature missing");
    addIssue(issues, buffer.length === expectedBytes, `bytes drifted: ${buffer.length}`);
    addIssue(issues, payloadHash === expectedHash, `SHA-256 drifted: ${payloadHash}`);
    return report(
      sourceId,
      url,
      {
        requestedTime: time,
        requestedBbox: "-97,28,-94,31",
        httpStatus: response.status,
        contentType,
        pngSignature,
        bytes: buffer.length,
        sha256: payloadHash,
      },
      issues
    );
  } catch (error) {
    return reportFailure(sourceId, url, error);
  }
}

async function checkGibsMetadata() {
  const url = URLS.gibsMetadata;
  const expectedHash = "20F8D14AEA651F0C4F7399C1D9AFBD14CA94B080FB364E7695815175A1EC67EC";
  try {
    const { response, buffer } = await fetchBuffer(url);
    const issues = [];
    const payloadHash = sha256(buffer);
    let metadata;
    try {
      metadata = JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      issues.push(`Metadata JSON parse failed: ${String(error)}`);
      metadata = {};
    }
    const conceptIds = Array.isArray(metadata.conceptIds) ? metadata.conceptIds : [];
    const finalConcept = conceptIds.find((item) => item?.type === "STD");
    const nrtConcept = conceptIds.find((item) => item?.type === "NRT");
    addIssue(issues, response.ok, `HTTP status ${response.status}`);
    addIssue(issues, payloadHash === expectedHash, `metadata SHA-256 drifted: ${payloadHash}`);
    addIssue(issues, metadata.ongoing === true, "metadata.ongoing is not true");
    addIssue(issues, metadata.layerPeriod === "Daily", `unexpected layerPeriod: ${metadata.layerPeriod}`);
    addIssue(issues, finalConcept?.value === "C2723754847-GES_DISC", "Final concept ID drifted");
    addIssue(issues, finalConcept?.shortName === "GPM_3IMERGHH", "Final short name drifted");
    addIssue(issues, finalConcept?.version === "07", "Final version drifted");
    addIssue(issues, nrtConcept?.value === "C2723758340-GES_DISC", "NRT concept ID drifted");
    addIssue(issues, nrtConcept?.shortName === "GPM_3IMERGHHE", "NRT short name drifted");
    addIssue(issues, nrtConcept?.version === "07", "NRT version drifted");
    return report(
      "nasa_gibs_imerg_metadata",
      url,
      {
        httpStatus: response.status,
        bytes: buffer.length,
        sha256: payloadHash,
        layerPeriod: metadata.layerPeriod ?? "missing",
        finalConcept: finalConcept ?? "missing",
        nrtConcept: nrtConcept ?? "missing",
      },
      issues
    );
  } catch (error) {
    return reportFailure("nasa_gibs_imerg_metadata", url, error);
  }
}

async function checkUsgs() {
  const url = URLS.usgs;
  try {
    const { response, buffer } = await fetchBuffer(url);
    const issues = [];
    const payloadHash = sha256(buffer);
    let data;
    try {
      data = JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      issues.push(`USGS JSON parse failed: ${String(error)}`);
      data = {};
    }
    const series = Array.isArray(data?.value?.timeSeries) ? data.value.timeSeries : [];
    const values = series.flatMap((item) =>
      Array.isArray(item?.values?.[0]?.value) ? item.values[0].value : []
    );
    const numericValues = values.map((item) => Number(item?.value));
    const qualifiers = [...new Set(values.flatMap((item) => item?.qualifiers ?? []))];
    const qualifierDefinitions = series.flatMap((item) => item?.values?.[0]?.qualifier ?? []);
    const queryNotes = Array.isArray(data?.value?.queryInfo?.note) ? data.value.queryInfo.note : [];
    const requestTimestamp = queryNotes.find((note) => note?.title === "requestDT")?.value;
    const serviceDisclaimer = queryNotes.find((note) => note?.title === "disclaimer")?.value;
    const firstValue = values[0];
    const lastValue = values.at(-1);
    const minimum = numericValues.length > 0 ? Math.min(...numericValues) : null;
    const maximum = numericValues.length > 0 ? Math.max(...numericValues) : null;

    addIssue(issues, response.ok, `HTTP status ${response.status}`);
    addIssue(issues, series.length === 1, `expected one timeSeries, got ${series.length}`);
    addIssue(issues, series[0]?.sourceInfo?.siteCode?.[0]?.value === "08074500", "site ID drifted");
    addIssue(issues, series[0]?.variable?.variableCode?.[0]?.value === "00065", "parameter code drifted");
    addIssue(issues, series[0]?.variable?.unit?.unitCode === "ft", "unit drifted");
    addIssue(issues, values.length === 288, `value count drifted: ${values.length}`);
    addIssue(issues, numericValues.every(Number.isFinite), "non-finite gage value returned");
    addIssue(issues, minimum === 9.14, `minimum drifted: ${minimum}`);
    addIssue(issues, maximum === 38.72, `maximum drifted: ${maximum}`);
    addIssue(issues, firstValue?.dateTime === "2024-07-08T00:00:00.000-05:00", "period start drifted");
    addIssue(issues, lastValue?.dateTime === "2024-07-10T23:45:00.000-05:00", "period end drifted");
    addIssue(issues, qualifiers.length === 1 && qualifiers[0] === "A", `qualifiers drifted: ${qualifiers.join(",")}`);
    addIssue(
      issues,
      qualifierDefinitions.some(
        (qualifier) =>
          qualifier?.qualifierCode === "A" &&
          String(qualifier?.qualifierDescription).includes("Approved for publication")
      ),
      "approved-publication qualifier definition missing"
    );
    addIssue(issues, typeof requestTimestamp === "string", "USGS request timestamp missing");
    addIssue(
      issues,
      typeof serviceDisclaimer === "string" && serviceDisclaimer.includes("subject to revision"),
      "USGS service disclaimer missing"
    );

    return report(
      "usgs_instantaneous_values",
      url,
      {
        httpStatus: response.status,
        bytes: buffer.length,
        sha256: payloadHash,
        requestTimestamp: requestTimestamp ?? "missing",
        siteId: series[0]?.sourceInfo?.siteCode?.[0]?.value ?? "missing",
        parameterCode: series[0]?.variable?.variableCode?.[0]?.value ?? "missing",
        unit: series[0]?.variable?.unit?.unitCode ?? "missing",
        valueCount: values.length,
        periodStart: firstValue?.dateTime ?? "missing",
        periodEnd: lastValue?.dateTime ?? "missing",
        minimum,
        maximum,
        qualifiers,
        serviceDisclaimer: serviceDisclaimer ?? "missing",
      },
      issues
    );
  } catch (error) {
    return reportFailure("usgs_instantaneous_values", url, error);
  }
}

async function main() {
  console.log("WP-02 manual live-source verification");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("No fixture fallback. Any hash, shape, count, or semantic drift fails the command.");

  await checkHmsKml({
    sourceId: "noaa_hms_fire_points",
    url: URLS.hmsFire,
    expectedBytes: 4006019,
    expectedHash: "878506D644EEAC979AE2BC9529B6825F53C0532769BB92796DC65B6FF1C8A67D",
    expectedPairs: 12986,
    boxes: [
      {
        name: "los_angeles",
        box: { west: -119, south: 33, east: -117, north: 35 },
        expected: 4942,
      },
      {
        name: "lake_michigan_no_observation",
        box: { west: -87.0, south: 43.0, east: -86.9, north: 43.1 },
        expected: 0,
      },
    ],
  });
  await checkHmsKml({
    sourceId: "noaa_hms_smoke_polygons",
    url: URLS.hmsSmoke,
    expectedBytes: 111554,
    expectedHash: "B7BF4B38E35C2C9DCBB09D20E8693FE3A73DA3F099B35226AAA3893A86F4BAAB",
    expectedPairs: 2285,
    boxes: [
      {
        name: "los_angeles",
        box: { west: -119, south: 33, east: -117, north: 35 },
        expected: 83,
      },
    ],
  });
  await checkGibsImage({
    sourceId: "nasa_gibs_imerg_observation",
    time: "2024-07-08",
    expectedBytes: 8627,
    expectedHash: "236E461C8EC64D7D0D3130D01D204EB2E8D4CEAADBBDCC59107DB51768A122B6",
  });
  await checkGibsImage({
    sourceId: "nasa_gibs_imerg_unsupported_coverage",
    time: "1990-01-01",
    expectedBytes: 1096,
    expectedHash: "074065F07E35265D9695CCED0F42844DBB02E5766C4ED185D0A372B2D033B093",
  });
  await checkGibsMetadata();
  await checkUsgs();

  const failures = results.filter((result) => result.status !== "success");
  console.log(`\nCompleted: ${new Date().toISOString()}`);
  console.log(`Results: ${results.length - failures.length} passed, ${failures.length} failed.`);
  console.log("Boundary: local manual live-source evidence; not CI, preview, deployment, production, or safety advice.");
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Fatal live-source verification error:", error);
  process.exit(1);
});
