# ADR-0013: Bounded Agent map and geography tools

**Status:** Accepted
**Date:** 2026-09-04

**Partially superseded by:**
[ADR-0014](ADR-0014-visible-place-lookup-and-map-sync.md), which replaces
Decision 2 and the corresponding place-lookup UI behavior. The original
decision is retained below as a historical record.

## Context

The six-tool WebMCP surface could run, compare, and inspect environmental
evidence, but an Agent could not answer a geography-only request or operate the
imagery controls already available to a person. Map state was also owned by
individual responsive map components, which allowed desktop and mobile views
to disagree.

Imagery has stricter semantics than analysis evidence. NASA GIBS layers are
visualizations for one calendar date, and the existing NASA FIRMS map adapter
is explicitly near-real-time. Silently using the end of a multi-day range or
showing an empty historical NRT result would imply precision the sources do not
provide.

## Decision

1. Extend the stable page-lifetime registry from six to eight tools. The two
   additions are `look_up_place_location` and
   `set_environmental_map_layers`; ADR-0012's stable registration and
   execution-time state-reading rules continue to apply to the full registry.
2. `look_up_place_location` is a read-only Photon/OpenStreetMap lookup. It
   reuses the analysis resolver, stable choice IDs, ambiguity pause, and stale-ID
   revalidation. Success returns a canonical label, WGS84 representative point,
   source-supplied bounding box or `null`, source-supplied administrative
   context, and attribution. It does not update the UI or infer missing facts.
3. `set_environmental_map_layers` accepts an exact desired-state patch for
   `rain_satellite`, `surface_heat_satellite`,
   `thermal_anomalies_firms`, and `flood_extent`. Omitted fields stay
   unchanged, `true` requests display, `false` hides, and repeating the same
   patch is idempotent. The output separates requested visibility from actual
   rendered visibility and reports each source status.
4. Human and Agent controls use one shared map state on desktop and mobile.
   Agent requests reveal the mobile Map view. A layer-only update preserves the
   active analysis; a place, UTC date, or radius change clears evidence tied to
   the previous context.
5. A map request represents exactly one UTC calendar date. A multi-day
   selection requires an explicit date and is never collapsed to its final day.
   When Photon supplies bounds, the map frames them; the representative point
   and radius remain the analysis-area definition.
6. Imagery states remain explicit: `hidden`, `loading`, `ready`,
   `no_imagery`, `source_failure`, and `unsupported_date`. No imagery and
   source failure are not evidence of no hazard or safety.
7. FIRMS map imagery supports only today and the previous UTC day. Older dates
   return `unsupported_date` before any NRT request. Historical wildfire
   questions continue through the separate environmental analysis pipeline.
8. Imagery remains visualization-only: IMERG precipitation rate is not flood
   amount or extent; MODIS land-surface temperature is not air temperature;
   FIRMS pixels are not fire perimeters or severity; and VIIRS 3-day flood
   extent is not water depth. None establishes property impact or safety.

## Consequences

- Geography, imagery control, evidence analysis, and source-coverage questions
  have separate tool-routing boundaries instead of one tool overclaiming all
  four jobs.
- A person can verify the Agent's requested layers in the same visible state on
  either responsive layout, and retries cannot accidentally toggle them off.
- Ambiguous place names still require a human decision; the new tools cannot
  bypass the established coordinate and provenance boundary.
- Older FIRMS map dates fail explicitly instead of producing a misleading
  empty NRT visualization. This does not reduce historical analysis coverage.
- Tests must cover all eight registrations, desired-state idempotence,
  requested-versus-rendered status, single-date rejection, desktop/mobile
  parity, Photon provenance, and the FIRMS unsupported-date short circuit.
