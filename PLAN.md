# Sky to Porch WebMCP Delivery Plan

**Status:** Approved for implementation
**Started:** 2026-08-26
**Owner:** HuiYing Chung
**Implementation and verification:** Codex
**Challenge window:** 2026-08-25 11:00 PT through 2026-09-03 13:00 PT

## Current progress

- W0 repository baseline: complete
- W1 shared analysis application layer: complete for the vertical slice
- W2 shared client controller and state: complete with renderer compatibility
- W3 WebMCP tool: implemented; supported-browser agent verification pending
- W4 provider cleanup: complete; deterministic-only application runtime
- W5 verification: typecheck, lint, 1270 unit tests, 132 integration tests,
  production build, 224 browser journeys, and secret check pass;
  supported-browser and model eval runs pending
- W5a shared-view UX: complete; full deterministic and browser regression pass
- W5b Canadian Flood ground evidence: complete; bounded ECCC GeoMet live smoke
  and the full 220-journey browser regression passed
- W5c Wind & Storm evidence: locally verified, including a live localhost
  related-context Agent bundle with separate successful wind and water chains;
  supported-browser Agent verification pending
- W5d compound environmental context: locally verified for Heat–Drought,
  Fire/Smoke–Air Quality, and Volcano–Air Quality–Heat, including one parallel
  shared-view transaction; supported-browser Agent verification pending
- W6 release and submission: pending explicit authorization

## 1. Goal

Meaningfully extend the existing Sky to Porch application with WebMCP so a
person and an AI agent can investigate environmental evidence together on the
same map, using the same validated observations, provenance, and limitations.

The extension must be more than an API wrapper. An agent analysis should
produce a useful structured result and synchronize the map and evidence panel
the person is viewing.

## 2. Prior-work boundary

The last product commit before the challenge window is:

cd8b8b35da82ab3f58091852163da252ff7b3d3e

Existing hazard adapters, evidence contracts, deterministic evaluators, map
components, UI, and tests are prior work. Work claimed for the WebMCP Challenge
begins after the sanitized single-root baseline commit
`b35fe49053d9f68856fd8db6a26f4d2e9b40e945` and is identified in subsequent
commits. See PRIOR_WORK.md.

## 3. Non-negotiable product boundaries

- No data does not mean no danger.
- Missing, failed, unsupported, stale, and inconclusive evidence remain
  distinct program states.
- Deterministic code owns validation, calculations, provenance, freshness,
  limitations, confidence, and safe-to-present decisions.
- An external browser agent may explain the compact validated tool result but
  may not manufacture observations or override deterministic safety decisions.
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

Core tool:

analyze_environmental_hazard

It should accept a place or selected area, hazard, time window, concern, and
optional question; execute the deterministic analysis pipeline; update the
shared map and evidence panel; and return a compact structured result with
state, observations, provenance, limitations, and verification links.

A second read-only tool may expose source coverage or the current analysis only
if agent-selection evals demonstrate a clear need. Avoid tool sequences that
are easy to call in the wrong order.

### W4 — Provider cleanup

- remove the imported internal-model router and paid-call control path;
- keep deterministic explanation as the only application-runtime path;
- let the external WebMCP agent explain only compact validated evidence;
- retain truthful prior-work attribution separately from active product code.

### W5 — Verification

- deterministic tests for schemas, tool execution, UI updates, and failures;
- tests for invalid input, unsupported coverage, no observation, source
  failure, stale response, cancellation, and compact output;
- agent evals for tool selection, parameters, sequencing, and full user
  journeys;
- ChatGPT in-app-browser and supported-Chrome verification;
- full CI, clean-clone build, and exact-candidate evidence.

### W5b — Canadian Flood ground evidence

- activate only the ECCC GeoMet `hydrometric-daily-mean` collection;
- query one bounded selected-area/date request with no credentials or retries;
- accept only exact-schema station coordinates inside the selected geometry;
- contribute validated daily-mean water level to the existing ground-gage
  evidence role without inferring flood thresholds, route status, or property
  impact;
- preserve no observation, source failure, pagination overflow, and
  non-applicable coverage as separate deterministic outcomes.

### W5c — Wind & Storm evidence and claim-discussion use case

- add `wind_storm` as a separate hazard from the existing `flood_storm` path;
- use in-area NOAA GHCNh wind speed and gust observations without importing
  rainfall, flood extent, or water-gage evidence;
- add pinned official Beryl regional context only within its governed date and
  area;
- expose machine-readable wind-only and water-only evidence scopes to WebMCP;
- default broad Agent questions to `related_context`, so a Wind question
  automatically gathers the separate Flood chain without asking the user to
  name the relevant data types; reserve `single_hazard_only` for an explicitly
  narrow request;
- make the insurer-discussion checklist conditional on a completed Home + Wind
  result and keep it local, bounded, and non-adjudicative;
- retain Home, Travel, Pets, Health, Power & Internet, and Community as the
  product's broader concern contexts.

### W6 — Release and submission

- reconcile prior work, README, UI, video, and submission claims;
- verify third-party data rights and attribution;
- run full-history and current-tree privacy/secret checks;
- verify the public repository license and live application;
- produce a public, narrated demo under three minutes;
- request explicit authorization for repository visibility, deployment, and
  submission as separate actions.

## 6. Product decision checkpoints

The product owner has ruled on the first three checkpoints:

1. an Agent analysis immediately updates the shared view, with a visible action
   receipt and a one-step restore instead of a mandatory preview;
2. ambiguous locations are returned as card-ready choices and require the
   person to choose; the Agent never guesses;
3. mobile opens Meaning, where a trust strip exposes evidence state, source
   count, limitations, and a direct Evidence action;
4. the primary demonstration uses Hurricane Beryl in Houston to ask whether
   wind could have damaged a roof and what official evidence can support an
   insurer discussion; this is one use case, not the site's entire purpose;
5. wind and water remain separate evidence chains. For a broad storm-impact
   question, the default related-context orchestration runs and labels both
   analyses instead of asking the user to enumerate hazards;
6. the same default applies to Heat–Drought, Fire/Smoke–Air Quality, and
   Volcano–Air Quality–Heat. Every chain remains independently sourced and the
   bundle states that co-occurrence is not causation. Only an explicitly
   single-hazard question may select `single_hazard_only`.

Technical WebMCP details remain Codex's responsibility.

## 7. Definition of done

- WebMCP tools are discoverable and executable in the required browser
  environments. (Pending supported-browser release verification.)
- Human and agent interactions share one evidence pipeline and UI state.
- The deterministic safety model is unchanged or stronger.
- Tool descriptions and outputs stay within current implementation guidance.
- All deterministic tests, model evals, CI, and exact-candidate checks pass.
  (Deterministic local gates pass; model evals and exact CI remain pending.)
- Prior work and new work are unambiguous.
- The repository is publicly reproducible under a recognized open-source
  license.
- The live app and demo show a complete human-agent experience.
