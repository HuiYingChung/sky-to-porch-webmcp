/**
 * ADR-0049: place search reachable by Enter, the selected place confirmed in
 * the query column, and the searched-radius note on thin evidence.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RadiusScopeNote } from "@/components/states/radius-scope-note";
import type { EvidenceObject } from "@/contracts/evidence";
import { buildGeocodedPlaceSelection } from "@/lib/location/selection";
import { AREA_RADIUS_MAX_KM } from "@/lib/location/area";

const START = "2011-03-11T00:00:00.000Z";
const END = "2011-03-11T23:59:59.999Z";

/** Sendai: the 2011 Tohoku epicentre sits ~130 km offshore from here. */
function sendaiSelection(radiusKm: number) {
  return buildGeocodedPlaceSelection(
    "Sendai, Miyagi Prefecture, Japan",
    { lon: 140.87, lat: 38.27 },
    radiusKm,
    "custom",
    START,
    END
  );
}

function evidenceWithState(state: EvidenceObject["evidenceState"]): EvidenceObject {
  return { evidenceState: state } as EvidenceObject;
}

describe("ADR-0049 radius scope note", () => {
  it("states the searched radius and the widening action on thin evidence", () => {
    for (const state of ["no_observation", "inconclusive_evidence"] as const) {
      const html = renderToStaticMarkup(
        <RadiusScopeNote
          evidence={evidenceWithState(state)}
          placeSelection={sendaiSelection(25)}
        />
      );
      expect(html).toContain("radius-scope-note");
      expect(html).toContain("25 km around the selected point");
      expect(html).toContain(`up to ${AREA_RADIUS_MAX_KM} km`);
    }
  });

  it("never claims anything about what lies outside the searched circle", () => {
    const html = renderToStaticMarkup(
      <RadiusScopeNote
        evidence={evidenceWithState("no_observation")}
        placeSelection={sendaiSelection(25)}
      />
    );
    // An unretrieved claim ("there are events further out") is exactly what
    // this product refuses to print; the note only bounds what was searched.
    expect(html).not.toMatch(/there (are|is)\b/iu);
    expect(html).not.toMatch(/nearby (event|earthquake)s? (exist|was|were)/iu);
    expect(html).toContain("are not retrieved");
  });

  it("stays silent when observations were returned, at max radius, or with no selection", () => {
    expect(renderToStaticMarkup(
      <RadiusScopeNote
        evidence={evidenceWithState("observations_returned")}
        placeSelection={sendaiSelection(25)}
      />
    )).toBe("");

    // At the widest supported radius there is no action left to offer.
    expect(renderToStaticMarkup(
      <RadiusScopeNote
        evidence={evidenceWithState("no_observation")}
        placeSelection={sendaiSelection(AREA_RADIUS_MAX_KM)}
      />
    )).toBe("");

    expect(renderToStaticMarkup(
      <RadiusScopeNote
        evidence={evidenceWithState("no_observation")}
        placeSelection={null}
      />
    )).toBe("");

    expect(renderToStaticMarkup(
      <RadiusScopeNote evidence={undefined} placeSelection={sendaiSelection(25)} />
    )).toBe("");
  });
});
