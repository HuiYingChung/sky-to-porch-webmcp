# ADR-0007: Unqualified storm questions use related context

**Status:** Accepted
**Date:** 2026-08-29

## Context

Sky to Porch intentionally split the former Flood & Storm surface into an
independent Wind & Storm chain and an independent Flood & Heavy Rain chain.
That separation prevents precipitation, inundation, or gage observations from
being presented as wind evidence.

The Agent-facing scope guidance later encouraged `single_hazard_only` whenever
the words in a question appeared to fit one hazard enum. A person asking only
whether there was a "storm" could therefore be routed to Wind alone, even
though ordinary storm evidence may include both wind and water context. This
was reproduced for Houston on 2026-08-28: the wind station-year lookup had no
usable row for the requested date, while the separate water chain returned
rain and gage evidence.

The Wind adapter also classified an in-area station-year lookup with no matching
requested-date row as `unsupported_coverage`. That wording incorrectly implied
that the place was outside source coverage instead of distinguishing a
completed lookup with no matching observation, including possible publication
or reporting lag.

## Decision

- An unqualified storm, thunderstorm, hurricane, tropical-storm, or
  severe-weather question uses `wind_storm` as its primary hazard with
  `related_context`.
- Deterministic execution expands that request to separate Flood & Heavy Rain
  and Wind & Storm chains. Results, sources, limitations, and confidence remain
  independent; one chain never substitutes for the other.
- A question explicitly restricted to wind, gust, hail, or tornado evidence may
  use the single Wind chain. A question explicitly restricted to rain, flood,
  inundation, water level, river, or gage evidence may use the single Flood
  chain.
- The Agent tool must preserve the person's question for an unqualified storm
  request. If an Agent nevertheless supplies `single_hazard_only` with that
  preserved generic wording, deterministic parsing upgrades it to
  `related_context`.
- When in-area GHCNh station-year files were retrieved but no usable wind row
  matched the requested UTC date, the Wind result and mission attribution use
  `no_observation`. `unsupported_coverage` remains reserved for cases such as no
  station inside the selected geometry.

## Consequences

- A generic storm question no longer loses available water evidence because the
  wind path is empty or awaiting publication.
- Explicit wind and water questions retain their faster single-chain path.
- No-observation wording no longer claims a geographic coverage gap and still
  states that missing data is not evidence that no storm occurred.
- This change adds no new provider or live-source integration. Source breadth
  can be evaluated separately without weakening the wind/water evidence
  boundary.
