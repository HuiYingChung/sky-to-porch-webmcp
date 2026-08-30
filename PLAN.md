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
- W3 WebMCP tools: four baseline tools plus two contextual tools implemented;
  product commit `72f3a36` fixes the production-reported Houston
  ambiguity loop with distinguishable locality/type labels, stable upstream
  place IDs, original-query continuation, exact retry arguments, and stale-ID
  rejection. It is published in merge commit `90b8236`; the production native
  tool journey now waits with no UI update, resumes by selected ID, completes
  both Beryl evidence chains, and updates the shared UI
- W4 provider cleanup: complete; deterministic-only application runtime
- W5 verification: exact local product commit `72f3a36` passes typecheck, lint,
  1,321 unit tests, 132 integration tests, a 14-page production build, a clean
  230-journey desktop/mobile Playwright run, and the repository secret gate.
  Final-schema `gpt-5-mini` with low reasoning passes three independent runs:
  66/66 semantic selection/argument cases and 12/12 ambiguity wait/resume cases
- W5a shared-view UX: complete; full deterministic and browser regression pass
- W5b Canadian Flood ground evidence: complete; bounded ECCC GeoMet live smoke
  and the full 220-journey browser regression passed
- W5c Wind & Storm evidence: the supported in-app browser locally verified the
  Beryl related-context bundle, separate Wind and Flood chains, synchronized
  shared UI, conditional claim guide, and narrow single-hazard boundary;
  those journeys now also pass in production. The current production stable-ID
  continuation returns a 2,110-character primary bundle, below the 2,400
  character cap
- W5d compound environmental context: locally verified for Heat–Drought,
  Fire/Smoke–Air Quality, and Volcano–Air Quality–Heat, including one parallel
  shared-view transaction; supported-browser Agent verification pending
- W5e Agent investigation upgrade: complete; adds recent NWS
  Local Storm Reports, two-scenario comparison, cross-source synthesis,
  focused follow-up, visible all-chain progress, and links to every result.
  The feature branch passes typecheck, lint, 1,353 unit tests, 133 integration
  tests, a 14-page production build, 234 desktop/mobile browser journeys, and
  the secret gate. A live Houston 2026-08-28 check returned the NWS flash-flood
  report, and focused model evaluation passed 3/3 selection cases plus 1/1
  plain-English two-chain summary case
- W6 release and submission: private release preparation remains in progress;
  the repo stays private by owner direction. Stable-place product commit
  `72f3a36` passed local, PR-head, post-merge main, deployment, and production
  native tool-level verification through merge `90b8236`. Public visibility,
  video publication, and submission remain separate owner decisions

The production/local/native evidence split for the current acceptance package
is recorded in
[`docs/testing/native-agent-acceptance-2026-08-27.md`](docs/testing/native-agent-acceptance-2026-08-27.md)
and the later production rerun is recorded in
[`docs/testing/native-agent-production-verification-2026-08-27.md`](docs/testing/native-agent-production-verification-2026-08-27.md).

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

It should accept a place or selected area, hazard, time window, optional
concern, and optional question; execute the deterministic analysis pipeline;
update the shared map and evidence panel; and return a compact structured
result with evidence strength, confidence, observations, structured citations,
and concise scope notes. Omitted concern resolves to neutral `general`. Curated
demo inputs and a person's own supported historical question must use the same
parser, analysis service, output contract, answer order, and shared UI update.

Two baseline discovery tools expose the governed hazard vocabulary and the
checked-in source-coverage catalog. Their descriptions direct a concrete
place-and-hazard question straight to the analysis tool, so discovery is not a
mandatory or fragile preflight sequence. Coverage output states that pipeline
eligibility is not proof of an observation. Contextual tools expose the current
validated evidence and, only after Home + Wind, the bounded claim-discussion
guide. A fourth baseline tool compares two independently specified scenarios
through the same shared analysis service. A generic storm comparison runs and
returns both the Wind and Flood chains for both scenarios, preserves each
scenario's supplied radius, and separates direct observation, supported
inference, unknowns, failed checks, and evidence that would change the
conclusion. The existing no-input hazard-list tool exposes compact ready inputs
for all three demos in one response; no selector, separate demo tool, or
citation tool is added.

### W4 — Provider cleanup

- remove the imported internal-model router and paid-call control path;
- keep deterministic explanation as the only application-runtime path;
- let the external WebMCP agent explain only compact validated evidence;
- retain truthful prior-work attribution separately from active product code.

### W5 — Verification

- deterministic tests for schemas, tool execution, UI updates, and failures;
- tests for invalid input, unsupported coverage, no observation, source
  failure, stale response, cancellation, structured citations, optional
  concern, related-chain support, and bounded output;
- agent evals for tool selection, parameters, sequencing, and full user
  journeys;
- a natural trigger case for every baseline and contextual tool, non-demo
  questions across all seven hazards, and a successful non-demo WebMCP browser
  journey in a city and time window not used by the curated demos;
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

### W5e — Agent investigation upgrade

- add recent, bounded NWS Preliminary Local Storm Reports to the independent
  Wind and Flood evidence chains without treating a missing report as no storm;
- rank direct geolocated event and ground observations ahead of regional
  visualizations in compact Agent output;
- add deterministic two-scenario comparison and cross-source synthesis while
  preserving every user-specified place, time, and radius;
- let the contextual inspection tool answer natural follow-ups about direct
  observations, source status, limitations, and evidence still needed without
  re-querying;
- show retrieving and synthesizing progress in the shared UI and retain a
  visible route to every completed chain;
- require summary-first plain English that keeps direct observation, inference,
  failure, and unknown state distinct.

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
   Volcano–Air Quality–Heat. Every chain remains independently sourced, while
   the bundle asks the Agent for the strongest evidence-supported inference
   and confidence and distinguishes that inference from direct observation.
   Only an explicitly single-hazard question may select `single_hazard_only`;
7. concern is optional for Agent analysis. The Agent infers it when clear,
   asks one short follow-up only when a broad goal needs it, and proceeds with
   `general` for a narrow factual historical request;
8. the curated Houston roof, Los Angeles health, and Tucson pet prompts require
   actual historical observations, citations, and an evidence-forward
   assessment. No-data and failure are last-resort states, not demo features;
9. panel switching, generic expansion, map-layer controls, and Start over stay
   as human UI actions for now rather than increasing the Agent tool count.
10. the demos are curated entrances, not privileged code paths. A supported
    custom question receives the same evidence-forward order: strongest
    assessment; observed values, times, and official citations; labelled
    inference; confidence; and evidence that would change the assessment.

Technical WebMCP details remain Codex's responsibility.

## 7. Definition of done

- WebMCP tools are discoverable in the supported production in-app browser.
  Product commit `72f3a36` fixes the reported same-label ambiguity loop and
  passes local deterministic, browser, three-run model, PR-head, post-merge,
  deployment, and production native tool-level checks at merge `90b8236`.
- Human and agent interactions share one evidence pipeline and UI state.
- The deterministic safety model is unchanged or stronger.
- Tool descriptions and outputs stay within current implementation guidance.
- All deterministic tests and exact-candidate checks pass locally. The
  separate model gate passes 66/66 semantic selection/argument cases and 12/12
  ambiguity wait/resume journeys across three runs. PR-head CI run
  `33127306578`, post-merge main CI run `33128144825`, Vercel deployment
  `dpl_DnNkQ5i91s8hEXsWvqr1JvSZNy4x`, and the production native tool journey
  are recorded as separate evidence.
- Prior work and new work are unambiguous.
- The repository is publicly reproducible under a recognized open-source
  license.
- The live app and demo show a complete human-agent experience.
