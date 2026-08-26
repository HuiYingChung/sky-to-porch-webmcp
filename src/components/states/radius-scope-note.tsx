"use client";
/**
 * src/components/states/radius-scope-note.tsx
 *
 * ADR-0049: when a result carries no observations (or inconclusive ones),
 * the analysis radius is the most common reason a well-known event is
 * missing — the 2011 Tohoku M9.1 epicentre sits ~130 km off Sendai, outside
 * the default 60 km circle, so a Sendai query returns only aftershocks.
 *
 * The note states the searched radius and what that excludes. It never
 * claims anything about what lies outside the circle: asserting "there are
 * events further out" would require a retrieval this component has not made,
 * and an unvalidated claim is exactly what this product refuses to print.
 */

import { AREA_RADIUS_MAX_KM } from "@/lib/location/area";
import type { EvidenceObject } from "@/contracts/evidence";
import type { PlaceSelection } from "@/lib/location/selection";

/** Evidence states where the searched area is worth restating. */
const THIN_EVIDENCE_STATES = new Set<EvidenceObject["evidenceState"]>([
  "no_observation",
  "inconclusive_evidence",
]);

export function RadiusScopeNote({
  evidence,
  placeSelection,
}: {
  evidence: EvidenceObject | undefined;
  placeSelection: PlaceSelection | null;
}) {
  if (!evidence || !placeSelection) return null;
  if (!THIN_EVIDENCE_STATES.has(evidence.evidenceState)) return null;

  // The note exists to offer one action. At the widest supported radius
  // there is no action left, and the searched circle is already drawn on the
  // map and stated in the selection card, so staying silent beats nagging.
  const radiusKm = placeSelection.analysisArea.radiusKm;
  if (radiusKm >= AREA_RADIUS_MAX_KM) return null;

  return (
    <p
      data-testid="radius-scope-note"
      style={{
        margin: "12px 0 0",
        padding: "8px 10px",
        border: "1px solid var(--border-subtle)",
        borderRadius: "6px",
        background: "var(--surface-2)",
        color: "var(--text-secondary)",
        fontSize: "14px",
        lineHeight: 1.5,
      }}
    >
      <strong style={{ color: "var(--text-primary)" }}>Searched area:</strong>{" "}
      {radiusKm} km around the selected point. Records centred outside that circle are
      not retrieved, so an event whose official location falls further out does not
      appear here. You can raise the analysis radius (up to {AREA_RADIUS_MAX_KM} km)
      and ask again.
    </p>
  );
}
