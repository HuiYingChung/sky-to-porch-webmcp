# Sky to Porch WebMCP Delivery Plan

**Status:** Approved for implementation
**Started:** 2026-08-26
**Owner:** HuiYing Chung
**Implementation and verification:** Codex
**Challenge window:** 2026-08-25 11:00 PT through 2026-09-03 13:00 PT

## 1. Goal

Meaningfully extend the existing Sky to Porch application with WebMCP so a
person and an AI agent can investigate environmental evidence together on the
same map, using the same validated observations, provenance, and limitations.

The extension must be more than an API wrapper. An agent analysis should
produce a useful structured result and synchronize the map and evidence panel
the person is viewing.

## 2. Prior-work boundary

The imported product baseline is the original Sky to Porch commit:

cd8b8b35da82ab3f58091852163da252ff7b3d3e

Existing hazard adapters, evidence contracts, deterministic evaluators, map
components, UI, and tests are prior work. Work claimed for the WebMCP Challenge
begins after the sanitized baseline import and is identified in subsequent
commits. See PRIOR_WORK.md.

## 3. Non-negotiable product boundaries

- No data does not mean no danger.
- Missing, failed, unsupported, stale, and inconclusive evidence remain
  distinct program states.
- Deterministic code owns validation, calculations, provenance, freshness,
  limitations, confidence, and safe-to-present decisions.
- AI may explain validated evidence but may not manufacture observations or
  override deterministic safety decisions.
- Regional evidence is not property-level certainty.
- The product does not replace official alerts or professional advice.
- Earthquake and eruption timing are out of scope.

## 4. Target architecture

    Human query form ----\\
                          > Shared Analysis Controller
    WebMCP tool ---------/             |
                                  Analysis Service
                         place -> coverage -> adapter
                                  -> evaluator -> result
                                          |
                             Unified AnalysisResult
                                  /               \\
                         shared map/UI       compact tool output

The human and agent paths must not duplicate hazard orchestration.

## 5. Work packages

### W0 — Repository and submission baseline

- create a sanitized, single-commit prior-work baseline;
- preserve the original repository and exact source commit;
- replace the restricted license with a recognized open-source license;
- remove obsolete competition governance and internal execution records from
  the public tree;
- update README, attribution, environment examples, and CI;
- pass the existing deterministic regression suite.

### W1 — Unified analysis application layer

- introduce provider-neutral AnalysisRequest and AnalysisResult contracts;
- create one application service for place, coverage, hazard retrieval,
  evaluation, and response shaping;
- preserve each existing adapter and fail-closed state;
- remove repeated route finalization where safely possible.

### W2 — Shared client state and controller

- replace hazard-specific active result state with one active analysis state;
- retain stale-response and cancellation protection;
- route the human form through the shared controller;
- expose the same controller to WebMCP registration.

### W3 — WebMCP vertical slice

Provisional core tool:

analyze_hazard_evidence

It should accept a place or selected area, hazard, time window, concern, and
optional question; execute the deterministic analysis pipeline; update the
shared map and evidence panel; and return a compact structured result with
state, observations, provenance, limitations, and verification links.

A second read-only tool may expose source coverage or the current analysis only
if agent-selection evals demonstrate a clear need. Avoid tool sequences that
are easy to call in the wrong order.

### W4 — Provider cleanup

- remove IBM watsonx/Granite from the product-critical path;
- keep deterministic explanation as the default;
- split transport, routing, evidence-context, and validation responsibilities;
- add an optional provider only if it materially improves the human experience
  without becoming a WebMCP prerequisite.

### W5 — Verification

- deterministic tests for schemas, tool execution, UI updates, and failures;
- tests for invalid input, unsupported coverage, no observation, source
  failure, stale response, cancellation, and compact output;
- agent evals for tool selection, parameters, sequencing, and full user
  journeys;
- ChatGPT in-app-browser and supported-Chrome verification;
- full CI, clean-clone build, and exact-candidate evidence.

### W6 — Release and submission

- reconcile prior work, README, UI, video, and submission claims;
- verify third-party data rights and attribution;
- run full-history and current-tree privacy/secret checks;
- verify the public repository license and live application;
- produce a public, narrated demo under three minutes;
- request explicit authorization for repository visibility, deployment, and
  submission as separate actions.

## 6. Product decision checkpoints

The user will be asked to rule on:

1. whether an agent analysis immediately changes the map or first previews the
   change;
2. how location ambiguity is resolved between the person and agent;
3. which evidence summary remains visible after an agent action;
4. the final three-minute demonstration journey.

Technical WebMCP details remain Codex's responsibility.

## 7. Definition of done

- WebMCP tools are discoverable and executable in the required browser
  environments.
- Human and agent interactions share one evidence pipeline and UI state.
- The deterministic safety model is unchanged or stronger.
- Tool descriptions and outputs stay within current implementation guidance.
- All deterministic tests, evals, CI, and exact-candidate checks pass.
- Prior work and new work are unambiguous.
- The repository is publicly reproducible under a recognized open-source
  license.
- The live app and demo show a complete human-agent experience.
