# WebMCP Evaluation Boundary

## Deterministic gates

The automated unit and browser tests verify facts owned by the application:

- tool schema and annotations;
- strict argument validation;
- place ambiguity without silent guessing;
- cancellation and registration lifecycle;
- shared map and evidence state;
- bounded output, evidence-strength summaries, and structured citations;
- neutral `general` fallback when concern is omitted;
- no-data safety language only when no usable observation is returned.

These tests do not prove that a language model will select the right tool.

## Agent-selection dataset

`tests/webmcp/tool-selection-evals.json` follows the current Chrome WebMCP
`messages` plus `expectedCall` examples. It includes capability discovery,
coverage-only discovery, curated-demo selection, direct, implicit, coordinate,
dated, concern-omitted, broad-clarification, ambiguous-place, and out-of-scope
prompts. Concrete questions must select
`analyze_environmental_hazard` directly instead of first calling either
discovery tool. It locks the scope rule: an explicitly narrow gust, gage,
temperature, fire, or air-quality question selects `single_hazard_only`; a
broad question leaves the default `related_context` in force. Broad examples
cover Wind with Flood, Heat with Drought, Fire/Smoke with Air Quality, and
Volcanoes with Air Quality and Heat. The tool then runs the governed
combination and reports how strongly official observations across the chains
support an inference.

`tests/webmcp/post-tool-behavior-evals.json` separately captures the missing
multi-turn boundary reported during challenge-Agent use: after an ambiguous
tool result, the model must ask the person to choose, make no second tool call,
select no candidate, and wait for the next user message. Its deterministic test
only validates the retained scenario and contract; it is not a model pass.

The dataset also includes post-analysis availability context for
`inspect_current_environmental_evidence` and the Home + Wind-only
`prepare_storm_claim_discussion`. At least one natural selection case must
exist for every registered baseline or contextual tool. Non-demo analysis
questions must cover all seven hazard families so curated prompts cannot mask
a generic-query regression.

Before release, run the dataset repeatedly with the challenge agent and record:

1. tool-selection accuracy;
2. exact required-argument accuracy;
3. concern, required time intent, radius, and explicit-coordinate-text accuracy;
4. whether ambiguous results cause a user question rather than a guessed pick;
5. whether out-of-scope requests avoid the tool.
6. whether `single_hazard_only` appears only for an explicitly restricted ask;
7. whether named or strongly implied extra hazards are included without
   exceeding the bounded related-chain limit.
8. whether capability questions select `list_environmental_hazards` without
   running evidence retrieval;
9. whether source eligibility questions select
   `get_environmental_source_coverage` and preserve the distinction between
   coverage and an actual observation;
10. whether concrete environmental questions bypass discovery and call the
    analysis tool directly.
11. whether a narrow factual historical question proceeds without forcing a
    concern, while a broad goal receives one useful clarification question;
12. whether an explicitly selected demo uses one ready input from the
    selector-free list response and then the analysis tool;
13. whether the final answer leads with the strongest observations, citations,
    evidence-supported inference, and confidence rather than repeated caveats.
14. whether every registered tool is selected for its distinct natural ask and
    never merely called to increase the visible tool count;
15. whether non-demo questions across all seven hazards preserve the same
    answer order and shared UI update as curated demos.
16. after `needs_place_choice`, whether the model asks the person to choose and
    produces no second tool call until a new user message arrives.

Do not call this dataset "passed" until the model-backed runs and raw outcomes
have been retained for the exact tool definition under review.

## Execution status — 2026-08-27

The full 22-case dataset and two multi-turn ambiguity cases remain checked in;
their deterministic structure tests pass. The owner authorized paid OpenAI
evaluation with a key stored only in gitignored `.env.local`. The runner loads
the key without logging or retaining it, sends only public eval prompts and
tool metadata, and writes raw responses under ignored
`artifacts/webmcp-evals/`.

Several calibration runs were deliberately retained. They exposed guessed
coordinates, optional-date invention, discovery-selector guessing, and one
overly permissive continuation scorer. Those findings caused the selector-free
discovery surface, label-only place choices, removal of public coordinate
fields, required `time` intent, and semantic continuation scoring in
ADR-0006. Failed calibration scores are not release evidence.

The final-schema one-run baseline used `gpt-5-mini` with minimal reasoning and
low text verbosity. Raw artifact:
`2026-08-27T20-36-49.746Z-gpt-5-mini.json`.

- tool selection and argument semantics: **18/22**;
- exact calls: **6/22**;
- expected-argument subset: **10/22**;
- ambiguous result asks and waits: **pass**;
- selected Springfield label resumes the unfinished analysis with
  `time=latest_completed`: **pass**;
- API usage: 25 responses; token totals are retained in the raw artifact.

This is a truthful partial model pass, not a passed 22-case gate. The remaining
semantic misses were two single-hazard questions expanded to related context,
one broad no-hazard question that should have asked for clarification, and one
Volcano question that selected the list tool as an unnecessary preflight.
Application-owned schema, execution, and browser tests remain separate from
these model-selection outcomes.

## Full journeys

The release candidate must also be tested in a supported browser for these
complete journeys:

- direct place query → evidence → visible map and Insight update;
- ambiguous place → user choice → selected-label follow-up → evidence;
- applicable official-source paths exhausted → strongest available evidence;
  only an actually empty result uses the explicit missing-data state;
- replacement or cancellation → stale result cannot overwrite the current view.
- Beryl maximum-gust question → one `single_hazard_only` Wind result;
- Beryl roof/claim question → one related-context bundle with regional wind and
  water observations, structured citations, and a confidence-labelled
  assessment → claim-discussion tool appears only for the Home concern;
- the bundled result cites no wind observation as flood evidence and no
  rain/gage observation as roof-wind evidence.
- Tucson pet concern → Heat and Drought chains with actual historical evidence,
  strongest readings, citations, and confidence;
- Los Angeles symptom concern → Fire/Smoke and Air Quality chains with actual
  historical evidence, strongest findings, citations, and confidence;
- Volcano context → independent Earth/Volcano, Air Quality, and Extreme Heat
  chains, with direct observations distinguished from confidence-labelled
  inference.
