/**
 * Owner-authorized generator for the USCRN Heat01 station allowlist
 * (ADR-0037). Two bounded requests, manual-only, never run from CI or tests:
 *
 *   USCRN_ALLOWLIST_GENERATION_AUTHORIZED=YES \
 *     npx vite-node --config vitest.config.ts scripts/generate-uscrn-station-allowlist.ts
 *
 * Sources:
 *   1. https://www.ncei.noaa.gov/pub/data/uscrn/products/stations.tsv
 *      (station coordinates and names)
 *   2. https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/
 *      (directory listing: which stations actually publish a Heat01 CSV)
 *
 * Only stations present in BOTH sources are emitted, so the allowlist never
 * points at a file that does not exist. Output overwrites
 * src/data/uscrn-heat01-stations.ts with a reviewable, committed literal.
 */

import { writeFileSync } from "fs";
import { resolve } from "path";

const AUTHORIZATION_FLAG = "USCRN_ALLOWLIST_GENERATION_AUTHORIZED";
const STATIONS_TSV_URL = "https://www.ncei.noaa.gov/pub/data/uscrn/products/stations.tsv";
const HEAT01_DIRECTORY_URL = "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/";
const OUTPUT_PATH = resolve(process.cwd(), "src/data/uscrn-heat01-stations.ts");
const TIMEOUT_MS = 30_000;

if (process.env[AUTHORIZATION_FLAG] !== "YES") {
  console.error(`[uscrn-allowlist] REFUSED: ${AUTHORIZATION_FLAG}=YES is required.`);
  process.exit(2);
}

async function fetchTextBounded(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`http_${response.status} for ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

console.log(`[uscrn-allowlist] request 1/2: GET ${STATIONS_TSV_URL}`);
const stationsTsv = await fetchTextBounded(STATIONS_TSV_URL);
console.log(`[uscrn-allowlist] request 2/2: GET ${HEAT01_DIRECTORY_URL}`);
const heat01Listing = await fetchTextBounded(HEAT01_DIRECTORY_URL);

// Heat01 file names carry the station identity: CRNHE0101-<ST>_<Name>.csv
const heat01StationIds = new Set(
  [...heat01Listing.matchAll(/CRNHE0101-([A-Za-z0-9_]+)\.csv/gu)].map((match) => match[1])
);
if (heat01StationIds.size === 0) throw new Error("no Heat01 files found in the directory listing");

interface AllowlistEntry {
  stationId: string;
  stationName: string;
  lat: number;
  lon: number;
}

const lines = stationsTsv.split(/\r?\n/u).filter((line) => line.trim().length > 0);
const headers = lines[0].split("\t");
const column = (name: string): number => {
  const index = headers.indexOf(name);
  if (index < 0) throw new Error(`stations.tsv is missing the ${name} column`);
  return index;
};
const STATE = column("STATE");
const LOCATION = column("LOCATION");
const VECTOR = column("VECTOR");
const NAME = column("NAME");
const LATITUDE = column("LATITUDE");
const LONGITUDE = column("LONGITUDE");
const OPERATION = column("OPERATION");

/**
 * Coordinates verified against the station's OWN Heat01 file rows (which
 * carry per-row LATITUDE/LONGITUDE) take precedence over the stations.tsv
 * registry, which can differ by ~0.01 degrees. Tucson's values were verified
 * by the ADR-0034 live path; add entries here only with the same evidence.
 */
const VERIFIED_FILE_COORDINATES: Record<string, { lat: number; lon: number }> = {
  AZ_Tucson_11_W: { lat: 32.24, lon: -111.17 },
};

const entries: AllowlistEntry[] = [];
const seen = new Set<string>();
for (const line of lines.slice(1)) {
  const cells = line.split("\t");
  if (cells.length !== headers.length) continue;
  // The Heat01 file id is <STATE>_<LOCATION>_<VECTOR> with spaces as underscores.
  const stationId = [cells[STATE], cells[LOCATION], cells[VECTOR]]
    .join("_")
    .replaceAll(" ", "_");
  if (!heat01StationIds.has(stationId) || seen.has(stationId)) continue;
  // A Heat01 file also exists for closed stations (e.g. AZ Phoenix 7 S ended
  // 2014-06): file presence is not currency. Only operational stations can
  // confirm current conditions; historical ground confirmation is GHCNh's
  // job (ADR-0036).
  if (cells[OPERATION].trim() !== "Operational") continue;
  const lat = Number(cells[LATITUDE]);
  const lon = Number(cells[LONGITUDE]);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) continue;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) continue;
  seen.add(stationId);
  const verified = VERIFIED_FILE_COORDINATES[stationId];
  entries.push({
    stationId,
    stationName: `${cells[STATE]} ${cells[LOCATION]} ${cells[VECTOR]}`.trim(),
    lat: verified?.lat ?? lat,
    lon: verified?.lon ?? lon,
  });
}
entries.sort((left, right) => left.stationId.localeCompare(right.stationId));

const unmatched = [...heat01StationIds].filter((id) => !seen.has(id)).sort();
console.log(
  `[uscrn-allowlist] heat01Files=${heat01StationIds.size} matched=${entries.length} ` +
    `unmatchedHeat01Ids=${unmatched.length}${unmatched.length ? ` (${unmatched.join(", ")})` : ""}`
);
const tucson = entries.find((entry) => entry.stationId === "AZ_Tucson_11_W");
if (!tucson || tucson.lat !== 32.24 || tucson.lon !== -111.17) {
  throw new Error("generation sanity check failed: AZ_Tucson_11_W must match ADR-0034 values");
}

const generatedAt = new Date().toISOString().slice(0, 10);
const body = entries
  .map(
    (entry) =>
      `  { stationId: "${entry.stationId}", stationName: "${entry.stationName}", ` +
      `lat: ${entry.lat}, lon: ${entry.lon} },`
  )
  .join("\n");
writeFileSync(
  OUTPUT_PATH,
  `/**
 * GENERATED FILE — do not edit by hand (ADR-0037).
 *
 * NOAA USCRN stations that publish a Heat01 hourly heat-exposure CSV.
 * Regenerate with scripts/generate-uscrn-station-allowlist.ts (owner
 * authorization required). Generated ${generatedAt} from:
 *   - ${STATIONS_TSV_URL}
 *   - ${HEAT01_DIRECTORY_URL}
 * Stations are emitted only when they appear in BOTH sources. stationId is
 * the Heat01 file identity: CRNHE0101-<stationId>.csv.
 */

export interface UscrnHeat01Station {
  readonly stationId: string;
  readonly stationName: string;
  readonly lat: number;
  readonly lon: number;
}

export const USCRN_HEAT01_STATIONS: readonly UscrnHeat01Station[] = [
${body}
];
`,
  { encoding: "utf8" }
);
console.log(`[uscrn-allowlist] wrote ${entries.length} stations to ${OUTPUT_PATH}`);
