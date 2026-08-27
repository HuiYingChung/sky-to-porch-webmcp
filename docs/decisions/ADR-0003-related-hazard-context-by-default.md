# ADR-0003: Related hazard context is the Agent default

**Status:** Accepted
**Date:** 2026-08-26

## Context

People often ask about an impact without knowing which environmental evidence
domains may be relevant. Requiring them to enumerate wind and water, heat and
drought, smoke and ambient air quality, or volcano, air, and heat would make
the Agent repeat the product's own domain knowledge. Leaving every association
to model improvisation would make the behavior inconsistent and untestable.

At the same time, co-occurrence is not causation. A drought classification does
not prove that drought caused a hot day; an air-quality observation does not
attribute pollution to a fire or volcano; a heat observation does not establish
a volcanic effect.

## Decision

The primary WebMCP tool accepts an `analysis_scope`:

- `related_context` is the product default;
- `single_hazard_only` is used only when the person's question explicitly
  restricts the requested evidence to one hazard.

For related context, deterministic code expands the primary hazard through a
bounded, non-recursive relationship table:

| Primary hazard | Default related evidence |
| --- | --- |
| Wind & Storm | Flood & Heavy Rain |
| Flood & Heavy Rain | Wind & Storm |
| Extreme Heat | Drought & Land |
| Drought & Land | Extreme Heat |
| Fire & Smoke | Air Quality |
| Air Quality | Fire & Smoke |
| Earth & Volcanoes | Air Quality and Extreme Heat |

The Agent may add hazards that are named or strongly implied by a broader
question. A bundle is capped at one primary plus three context hazards. Default
relationships do not recurse, so a companion does not silently pull in its own
companions.

Every chain runs through its existing independent analysis contract. Independent
retrievals execute in parallel under one cancellation and generation guard;
the shared view commits the primary and related results once the bundle is
complete, so intermediate chains do not flash as the active answer. The
compact result reports `relationship: co_occurring_context_not_causation`, an
ordered `included_chains` list, and a distinct `evidence_scope` for each chain.
The shared UI shows the primary result followed by separately labelled related
evidence sections. Inspecting the current result also reports the related chain
statuses without starting another request.

All chains use one completed UTC date as a common temporal anchor. A multi-day
request must use `single_hazard_only` until cross-source range semantics are
defined without hiding different source cadences.

## Consequences

- Broad Agent questions receive predictable related evidence without requiring
  the person to know the source taxonomy.
- Independent chains avoid a sequential network waterfall while still
  committing as one shared-view transaction.
- Explicitly narrow questions retain a fast single-chain path.
- Source failure, no observation, unsupported coverage, freshness, and
  limitations remain independent for every chain.
- Neither tool output nor UI wording may infer cross-hazard causation or replace
  one hazard's missing evidence with another hazard's observation.
- The relationship table and Agent-selection examples are deterministic test
  surfaces and can be extended without adding a new tool for every permutation.
