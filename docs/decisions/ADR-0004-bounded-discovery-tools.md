# ADR-0004: Bounded discovery tools without a mandatory waterfall

**Status:** Accepted
**Date:** 2026-08-26

## Context

The primary analysis tool already accepts the governed hazard vocabulary and
runs the complete place, time, retrieval, validation, evidence, and shared-UI
path. Its schema is sufficient for a capable Agent to answer a concrete
environmental question directly.

However, a person may instead ask what Sky to Porch supports or what source
coverage exists before requesting observations. Encoding those answers only in
the analysis schema makes capability discovery less explicit. Splitting every
analysis step into its own tool would create a fragile sequence in which an
Agent could call tools in the wrong order or mistake source eligibility for an
observation.

## Decision

Register three baseline tools whenever WebMCP is available:

1. `analyze_environmental_hazard` directly handles a concrete place-and-hazard
   question, retrieves validated evidence, and synchronizes the shared UI.
2. `list_environmental_hazards` returns the product-owned hazard IDs, concern
   vocabulary, and bounded related-context defaults. It is for capability
   questions or genuine ambiguity only.
3. `get_environmental_source_coverage` reads the same checked-in coverage
   catalog used by the human About UI. A hazard-only call returns a source
   index; an optional `source_id` returns one detailed profile.

The discovery tools are read-only, do not update the UI, and perform no live
request. Coverage output is labelled
`pipeline_eligibility_not_observation`, sets
`actual_observation_not_established: true`, and directs a concrete place/time
request to the primary analysis tool.

Keep two state-scoped tools:

- `inspect_current_environmental_evidence` exists only while a completed
  analysis is active;
- `prepare_storm_claim_discussion` exists only for a completed Home + Wind
  result with a bounded discussion guide.

Do not add a demo-story tool: demo stories remain UI and documentation entry
points rather than a product capability. Do not rename current-evidence
inspection to “current answer,” because the page holds validated evidence and
limitations, not an automatically authoritative answer.

The three baseline registrations share one abort lifecycle. If any registration
fails, deterministic code aborts the group rather than leaving a partially
discoverable tool surface.

## Consequences

- The initial Agent surface contains three meaningful tools and can grow to
  five only when validated page state makes the contextual tools useful.
- Concrete analysis stays one tool call; discovery never becomes a required
  preflight chain.
- Capability and coverage questions can be answered without running providers,
  consuming credentials, or changing the shared view.
- The coverage catalog remains one source of truth for the human UI and Agent.
- Tool-selection evaluation must distinguish capability discovery,
  coverage-only discovery, direct analysis, contextual inspection, and
  out-of-scope no-call behavior.
- Deterministic tests own schemas, lifecycle, compact output, and the
  coverage-versus-observation boundary; model-backed selection remains a
  separate release gate.
