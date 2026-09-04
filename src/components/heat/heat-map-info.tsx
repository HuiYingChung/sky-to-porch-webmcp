"use client";

import type { HeatQueryResult } from "@/lib/heat/types";
import { publicObservationValue } from "@/lib/ui/public-presentation";

export function HeatMapCoverageLabel({ result }: { result: HeatQueryResult }) {
  const evidence = result.evidence;
  if (!evidence) return null;
  const gibs = evidence.observations.find(
    (observation) => observation.provenance.sourceId === "nasa_gibs_modis_lst_day"
  );
  const air = evidence.observations.find(
    (observation) => observation.metadata?.heatRole === "ground_air_temperature"
  );
  const index = evidence.observations.find(
    (observation) => observation.metadata?.heatRole === "derived_heat_index"
  );
  return (
    <div
      data-testid="heat-map-coverage-label"
      style={{
        width: "min(340px, calc(100vw - 16px))",
        boxSizing: "border-box",
        padding: "8px",
        border: "1px solid var(--border-default)",
        borderRadius: "4px",
        background: "var(--surface-1)",
        color: "var(--text-primary)",
        fontSize: "14px",
        opacity: 0.96,
      }}
    >
      <strong>Regional Extreme Heat evidence</strong>
      <div>NASA GIBS: {gibs ? "visualization available · no numeric temperature inferred" : "not provided"}</div>
      <div>AZ Tucson 11 W air: {air ? publicObservationValue(air.value, air.unit) : "not provided"}</div>
      <div>NOAA-derived heat index: {index ? publicObservationValue(index.value, index.unit) : "not provided"}</div>
      <div style={{ color: "var(--status-warning-fg)", marginTop: "4px" }}>
        No indoor temperature, household certainty, or individual medical-risk layer is shown.
      </div>
    </div>
  );
}
