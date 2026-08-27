import type { BoundingBox } from "@/contracts/common";
import {
  NCEI_GHCNH_MAX_CONCURRENCY,
  NCEI_GHCNH_MAX_OBSERVATION_ROWS,
  NCEI_GHCNH_MAX_REQUESTS,
  NCEI_GHCNH_MAX_STATION_CANDIDATES,
  NCEI_GHCNH_SOURCE_ID,
} from "@/lib/heat/ground-source-contract";
import { validateQueryArea } from "@/lib/location/query-area";

export interface PreparedGhcnhWindPlan {
  sourceId: typeof NCEI_GHCNH_SOURCE_ID;
  area: BoundingBox;
  date: string;
  requiredVariables: readonly ["wind_direction", "wind_speed", "wind_gust"];
  maximumStationCandidates: typeof NCEI_GHCNH_MAX_STATION_CANDIDATES;
  maximumObservationRows: typeof NCEI_GHCNH_MAX_OBSERVATION_ROWS;
  maximumRequests: typeof NCEI_GHCNH_MAX_REQUESTS;
  maximumConcurrency: typeof NCEI_GHCNH_MAX_CONCURRENCY;
  outsideAreaFallback: false;
}

export function buildPreparedGhcnhWindPlan(
  date: string,
  value: unknown
): PreparedGhcnhWindPlan {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== date
  ) throw new Error("invalid GHCNh wind date");
  return {
    sourceId: NCEI_GHCNH_SOURCE_ID,
    area: validateQueryArea(value),
    date,
    requiredVariables: ["wind_direction", "wind_speed", "wind_gust"],
    maximumStationCandidates: NCEI_GHCNH_MAX_STATION_CANDIDATES,
    maximumObservationRows: NCEI_GHCNH_MAX_OBSERVATION_ROWS,
    maximumRequests: NCEI_GHCNH_MAX_REQUESTS,
    maximumConcurrency: NCEI_GHCNH_MAX_CONCURRENCY,
    outsideAreaFallback: false,
  };
}
