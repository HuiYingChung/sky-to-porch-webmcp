# ADR-0002: Keep wind and water evidence as separate hazard chains

**Status:** Accepted for evidence separation; orchestration superseded by ADR-0003
**Date:** 2026-08-26

## Context

A severe storm can create several hazards at the same place and time. Hurricane
Beryl is a useful Houston example because a person may need both wind evidence
for possible roof damage and rainfall or flooding evidence for water impacts.
The shared event name does not make those observations interchangeable.

Combining wind, rain, inundation, and gage records in one undifferentiated
result would make it easy for a person or Agent to use evidence for the wrong
claim. It could also turn regional event context into unsupported property
causation.

## Decision

Maintain two explicit evidence chains:

- `wind_storm`, labelled **Wind & Storm**, uses wind speed, wind gust, and
  governed official wind-event context. It may support a bounded discussion of
  possible wind damage, but it does not establish damage, causation, policy
  coverage, liability, repair scope, or a claim outcome.
- `flood_storm`, labelled **Flood & Heavy Rain**, uses precipitation, flood
  extent, inundation, and water-gage evidence. It does not establish wind
  damage or wind causation.

Every primary WebMCP result exposes a machine-readable `evidence_scope`.
Contextual evidence inspection repeats that scope. For a broad storm damage or
insurance-discussion question, the default related-context orchestration runs
both domain analyses and returns one compact bundle containing two labelled,
unmerged chains. The user does not need to know which sources or hazards to
request. ADR-0003 generalizes this orchestration to other related hazards.

The Agent uses `single_hazard_only` with `wind_storm` or `flood_storm` only
when the question is clearly narrow, such as a maximum-gust question or a
water-gage question.

The Houston Beryl roof-and-insurer story is one useful Home workflow. Sky to
Porch remains a general environmental-evidence product for Home, Travel, Pets,
Health, Power & Internet, and Community concerns.

## Source roles

- NOAA NCEI GHCNh contributes selected-area station wind speed and gust only.
- The pinned NWS Houston/Galveston Beryl report contributes regional post-event
  wind context only when the selected date and area match its governed scope.
- Flood imagery, precipitation products, and water gages remain in the Flood &
  Heavy Rain chain.
- A catalog source may describe more than one hazard, but an individual result
  includes only observations admitted by its selected hazard adapter.

## Consequences

- An Agent can distinguish duplicate event context from duplicate evidence.
- A person can ask a natural, incomplete storm-damage question without first
  choosing wind versus water evidence.
- Wind and water evidence may be compared without being merged.
- The UI and tool output use matching boundaries.
- Property-level and insurance decisions remain outside the product's evidence
  authority.
