# ADR-0005: Evidence-forward Agent tools and demo journeys

**Status:** Superseded in part by ADR-0006
**Date:** 2026-08-27

## Context

The first WebMCP surface was safe and deterministic, but its output and visible
copy placed repeated no-data and non-causation warnings ahead of useful
findings. That made successful retrieval look like refusal. A strong historical
demo must instead show what official records establish, how strongly related
evidence reinforces the person's concern, and which citations support the
assessment.

People also do not always state a concern. A narrow factual evidence question
should not be blocked by a required concern, while a broad goal may benefit
from one short Agent follow-up. Demo concerns are curated storytelling inputs,
not a requirement imposed on every user.

## Decision

Keep the existing three baseline tools and two contextual tools. Do not add a
demo, citation, panel-control, map-layer, expand/collapse, or start-over tool.

- `analyze_environmental_hazard` makes concern optional and resolves omission
  to `general`. The Agent infers a clearly stated concern, asks one brief
  question only when a broad goal or scoped workflow needs it, and proceeds
  without asking for a narrow historical evidence request.
- Analysis queries every applicable integrated official-source path, leads
  with observation coverage and confidence, and returns bounded structured
  citations containing source, product, observed time, retrieved time, and a
  verification URL.
- Related bundles report `related_evidence_for_assessment`, the number of
  chains with observations, and an instruction to state the strongest
  evidence-supported inference with confidence. Direct observations remain
  distinguishable from inference; inference is not categorically banned.
- `inspect_current_environmental_evidence` returns strongest primary and
  related observations, confidence, and citations without re-querying or
  controlling the UI.
- `list_environmental_hazards` also exposes a compact curated-demo index and
  returns one selected scenario by `demo_id`. Concrete questions still call
  analysis directly, so demo selection does not create a mandatory waterfall.
- `prepare_storm_claim_discussion` leads with a confidence-labelled regional
  wind assessment and supporting evidence, then shows property-specific
  questions and documentation that can strengthen or weaken the assessment.

Three curated historical prompts cover a Houston roof concern after Hurricane
Beryl, Los Angeles coughing and eye irritation during the January 2025 fires,
and a lethargic dog after Tucson outdoor heat. Each asks for the strongest
evidence-supported assessment, citations, a distinction between observation
and inference, and a confidence level.

No-data and failure states remain truthful last-resort states after applicable
retrieval paths are exhausted. They are not a demo capability or the lead
product narrative.

Panel switching, generic expansion, map-layer controls, and Start over remain
human UI actions. They do not improve evidence retrieval or explanation enough
to justify increasing Agent tool-selection ambiguity at this stage.

## Consequences

- Successful Agent journeys lead with useful official findings rather than a
  list of prohibitions.
- The Agent has enough provenance to cite evidence without scraping the UI.
- Concern omission does not silently become Home and does not block factual
  historical requests.
- Reasonable inference is encouraged when its observation basis, scale, and
  confidence are explicit.
- Tool count stays small, and deterministic tests cover direct analysis,
  clarification, demo selection, citations, related support, and no-call cases.
