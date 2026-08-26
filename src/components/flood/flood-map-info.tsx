"use client";

import type { FloodQueryResult } from "@/lib/flood/types";

export function FloodMapCoverageLabel({ result }: { result: FloodQueryResult }) {
  const evidence = result.evidence;
  if (!evidence) return null;
  const gibs = evidence.observations.find(
    (observation) => observation.provenance.sourceId === "nasa_gibs_imerg"
  );
  const gage = evidence.observations.find(
    (observation) =>
      observation.provenance.sourceId === "usgs_instantaneous_values" ||
      observation.provenance.sourceId === "canada_geomet"
  );
  const gageLabel = gage?.provenance.sourceId === "canada_geomet" ? "ECCC gage" : "USGS gage";
  return (
    <div
      data-testid="flood-map-coverage-label"
      style={{
        width: "min(320px, calc(100vw - 16px))",
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
      <strong>Regional Flood evidence area</strong>
      <div>{gibs?.metadata?.boundingBox ?? "Houston demonstration bounds"}</div>
      <div>GIBS: {gibs?.provenance.observedAt ?? "not provided"}</div>
      <div>{gageLabel}: {gage ? `${gage.value} ${gage.unit}` : "not provided"}</div>
      <div style={{ color: "var(--status-warning-fg)", marginTop: "4px" }}>
        No surface-water, road-closure, route-safety, or property-impact geometry is shown.
      </div>
    </div>
  );
}
