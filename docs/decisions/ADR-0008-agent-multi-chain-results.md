# ADR-0008: Agent multi-chain results remain complete and navigable

**Status:** Accepted
**Date:** 2026-08-29

## Context

Related-context analysis can run two or three independent evidence chains in
one Agent action. The shared interface previously showed the current primary
result prominently while related results were easier to miss. An Agent could
also summarize only the primary chain even though the tool had completed every
requested chain. That made the Agent-assisted path weaker than repeating the
same hazards manually.

## Decision

- Every related-context result bundle requires the Agent to report every
  included evidence chain. A stronger chain must not hide an empty, failed, or
  inconclusive companion chain, and an empty chain must not hide evidence from
  another chain.
- The Agent-facing result contract provides a human-readable chain name and a
  plain-English status summary alongside the deterministic hazard identifier.
  The final response begins with an overall summary, then gives each chain's
  status, strongest evidence, observation time, source, and limitation. It does
  not repeat internal field names or enum values.
- The top-right Agent receipt lists every completed chain and provides one
  result button per chain. Each button opens the evidence view and focuses the
  corresponding chain, including the separately rendered Flood & Heavy Rain
  panel used by Wind & Storm analyses.
- This behavior is generic. It applies to every governed related-context plan,
  including Wind with Flood, Heat with Drought, Fire/Smoke with Air Quality,
  and Earth/Volcanoes with Air Quality and Heat.
- The Agent-assisted interface explicitly explains its advantage: one question
  can split, run, compare, and expose separate evidence chains without making
  the person repeat the manual workflow one hazard at a time.
- Human UI and Agent output still consume the same completed analyses. The
  Agent does not merge observations, invent missing results, or change source,
  time, confidence, or safety boundaries.

## Consequences

- A person can see that every chain ran, inspect each result directly, and read
  the same complete outcome in the Agent conversation.
- Mixed evidence is represented honestly, such as precipitation evidence plus
  no matching wind observation, rather than collapsed to a global no-data
  result.
- Browser tests verify both the general multi-chain receipt and the special
  Wind/Flood layout. Model-backed evaluation separately verifies the final
  plain-English response behavior.
