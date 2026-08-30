# ADR-0009: Agent investigations add recent event reports, comparison, and follow-up

**Status:** Accepted
**Date:** 2026-08-29

This decision supersedes ADR-0005 only on the fixed three-baseline-tool count.
Its evidence-forward boundaries and contextual-registration rules remain in
force.

## Context

The original human interface could show useful Houston storm context on
2026-08-28, while the Agent path could return a much weaker answer. Splitting
Wind & Storm from Flood & Heavy Rain was necessary for claim separation, but
the Wind chain's station lookup and the Flood chain's imagery/gage sources did
not include recent, geolocated NWS event reports. Agent summaries also favored
the first visualization in a result, had no two-scenario comparison tool, and
could not answer focused follow-ups about failed sources or evidence gaps
without another query.

## Decision

- Add bounded NWS Preliminary Local Storm Reports as a supporting official
  source for recent completed dates. Accept a report only when its event class
  belongs to the requested Wind or Flood chain, its report date matches the
  requested date range, and its coordinate is inside the exact selected
  geometry. The selected radius is never changed.
- Keep the NWS report preliminary and regional. It does not establish
  address-level wind or water depth, property damage, route safety, causation,
  or claim outcome. A missing or failed report check is not evidence that no
  storm occurred.
- Rank direct, geolocated event and ground observations ahead of regional
  visualization evidence in compact Agent summaries. The validated evidence
  object and human panels retain their original full ordering and provenance.
- Register a comparison tool that runs two independently specified
  place/time/radius scenarios through the same shared analysis service. A
  generic storm comparison runs separate Wind and Flood chains for both
  scenarios. The result reports every scenario and every chain, followed by
  deterministic agreements, differences, unknowns, source status, and what
  evidence would change the conclusion.
- Extend the current-evidence inspection tool with focused, read-only follow-up
  views for direct observations, sources, limitations, and evidence needed.
  These views never re-query or change the map.
- Show Agent investigation progress in the shared interface, including the
  number of completed evidence chains. On completion, retain one visible link
  for every result and explain that Agent assistance removed the need to rerun
  the manual interface chain by chain.

## Consequences

- Houston 2026-08-28 can surface the official Harris County flash-flood Local
  Storm Report in the Flood chain while the independent Wind chain may still
  truthfully report no matching wind observation.
- Comparison and related-context investigations preserve user-specified
  radii and keep missing, failed, inconclusive, and observed states separate.
- Agent conversations can produce a summary-first, plain-English answer and
  then answer natural source/gap follow-ups from the validated current result.
- Unit, integration, model-selection, and browser tests must cover the recent
  event adapter, all-chain visibility, progress, comparison, focused follow-up,
  and compact-output limits.
