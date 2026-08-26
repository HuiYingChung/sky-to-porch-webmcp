import sharp from "sharp";
import {
  AIRNOW_DAILY_FILENAME,
  AIRNOW_DAILY_HOST,
} from "./airnow-daily-live-adapter";
import {
  HANS_HOST,
  HANS_SEARCH_PATH,
  HANS_VOLCANO_PATH,
} from "./hans-live-adapter";
import {
  USGS_EARTHQUAKE_HOST,
  USGS_EARTHQUAKE_MAX_EVENTS,
  USGS_EARTHQUAKE_PATH,
} from "./usgs-earthquake-live-adapter";

const GIBS_HOST = "gibs.earthdata.nasa.gov";
const GIBS_PATH = "/wms/epsg4326/best/wms.cgi";
const AIRNOW_DAILY_PATH = new RegExp(
  `^/airnow/(\\d{4})/(\\d{8})/${AIRNOW_DAILY_FILENAME.replace(".", "\\.")}$`,
  "u"
);

let opaquePng: Promise<ArrayBuffer> | undefined;
let transparentPng: Promise<ArrayBuffer> | undefined;

function fixturePng(alpha: 0 | 255): Promise<ArrayBuffer> {
  const current = alpha === 0 ? transparentPng : opaquePng;
  if (current) return current;
  const generated = sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 42, g: 96, b: 128, alpha: alpha / 255 },
    },
  }).png().toBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    return bytes.buffer;
  });
  if (alpha === 0) transparentPng = generated;
  else opaquePng = generated;
  return generated;
}

function airNowDailyFixture(pathname: string): string | null {
  const match = AIRNOW_DAILY_PATH.exec(pathname);
  if (!match || match[2].slice(0, 4) !== match[1]) return null;
  const compactDate = match[2];
  const localDate = `${compactDate.slice(4, 6)}/${compactDate.slice(6, 8)}/${compactDate.slice(2, 4)}`;
  return [
    localDate,
    "480000001",
    "Deterministic Houston monitor",
    "PM2.5-24HR",
    "UG/M3",
    "11.2",
    "24",
    "Deterministic AirNow fixture",
    "42",
    "0",
    "29.5000",
    "-95.5000",
    "840480000001",
  ].join("|");
}

function earthquakeFixture(url: URL): Record<string, unknown> | null {
  if (
    url.searchParams.get("format") !== "geojson" ||
    url.searchParams.get("eventtype") !== "earthquake" ||
    url.searchParams.get("orderby") !== "time-asc" ||
    url.searchParams.get("limit") !== String(USGS_EARTHQUAKE_MAX_EVENTS) ||
    url.searchParams.get("nodata") !== "204"
  ) return null;
  const start = Date.parse(url.searchParams.get("starttime") ?? "");
  const end = Date.parse(url.searchParams.get("endtime") ?? "");
  const south = Number(url.searchParams.get("minlatitude"));
  const north = Number(url.searchParams.get("maxlatitude"));
  const west = Number(url.searchParams.get("minlongitude"));
  const east = Number(url.searchParams.get("maxlongitude"));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
    !Number.isFinite(south) || !Number.isFinite(north) || !Number.isFinite(west) ||
    !Number.isFinite(east) || south >= north || west >= east) return null;
  const eventTime = start + 12 * 60 * 60 * 1_000;
  const date = new Date(start).toISOString().slice(0, 10);
  return {
    type: "FeatureCollection",
    metadata: { generated: eventTime + 60_000, count: 1, status: 200 },
    features: [{
      type: "Feature",
      id: `us-e2e-${date.replaceAll("-", "")}`,
      properties: {
        mag: 2.1,
        place: "Deterministic E2E event inside the selected area",
        time: eventTime,
        updated: eventTime + 60_000,
        status: "reviewed",
        magType: "ml",
        type: "earthquake",
      },
      geometry: {
        type: "Point",
        coordinates: [(west + east) / 2, (south + north) / 2, 7.5],
      },
    }],
  };
}

/**
 * Fail-closed transport for the local Playwright server only. Every accepted
 * upstream URL receives a deterministic fixture; nothing is passed through to
 * global fetch.
 */
export const coverageGapE2eFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const airNowFixture = airNowDailyFixture(url.pathname);
  if (
    url.protocol === "https:" &&
    url.hostname === AIRNOW_DAILY_HOST &&
    airNowFixture !== null &&
    (init?.method ?? "GET") === "GET"
  ) {
    return new Response(airNowFixture, {
      status: 200,
      headers: { "Content-Type": "binary/octet-stream" },
    });
  }
  if (url.protocol === "https:" && url.hostname === GIBS_HOST && url.pathname === GIBS_PATH) {
    const layer = url.searchParams.get("LAYERS") ?? "";
    if (layer === "MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth") {
      return new Response(await fixturePng(255), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }
    if (layer === "OMPS_NOAA20_SO2_Lower_Troposphere") {
      return new Response(await fixturePng(0), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }
  }
  if (
    url.protocol === "https:" &&
    url.hostname === HANS_HOST &&
    url.pathname === HANS_VOLCANO_PATH &&
    (init?.method ?? "GET") === "GET"
  ) {
    return Response.json([], { status: 200 });
  }
  if (
    url.protocol === "https:" &&
    url.hostname === HANS_HOST &&
    url.pathname === HANS_SEARCH_PATH &&
    init?.method === "POST"
  ) {
    return Response.json([], { status: 200 });
  }
  if (
    url.protocol === "https:" &&
    url.hostname === USGS_EARTHQUAKE_HOST &&
    url.pathname === USGS_EARTHQUAKE_PATH &&
    (init?.method ?? "GET") === "GET"
  ) {
    const fixture = earthquakeFixture(url);
    if (fixture !== null) return Response.json(fixture, { status: 200 });
  }
  throw new Error(`Blocked unexpected coverage-gap E2E request: ${url.origin}${url.pathname}`);
};
