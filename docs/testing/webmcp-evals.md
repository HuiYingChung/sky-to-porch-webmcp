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

The dataset also includes post-analysis availability context for
`inspect_current_environmental_evidence` and the Home + Wind-only
`prepare_storm_claim_discussion`. At least one natural selection case must
exist for every registered baseline or contextual tool. Non-demo analysis
questions must cover all seven hazard families so curated prompts cannot mask
a generic-query regression.

Before release, run the dataset repeatedly with the challenge agent and record:

1. tool-selection accuracy;
2. exact required-argument accuracy;
3. concern, date, radius, and coordinate accuracy;
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
12. whether an explicitly selected demo uses the existing list tool's
    `demo_id` detail and then the analysis tool, without adding a new tool;
13. whether the final answer leads with the strongest observations, citations,
    evidence-supported inference, and confidence rather than repeated caveats.
14. whether every registered tool is selected for its distinct natural ask and
    never merely called to increase the visible tool count;
15. whether non-demo questions across all seven hazards preserve the same
    answer order and shared UI update as curated demos.

Do not call this dataset "passed" until the model-backed runs and raw outcomes
have been retained for the exact tool definition under review.

## Execution status — 2026-08-27

The full 22-case dataset remains checked in and its deterministic structure
tests pass. The production in-app-browser work on this date directly invoked
named tools to verify their execution and shared UI behavior; it was not a
model-selection run.

No model-eval backend was configured in the private verification environment:
the OpenAI, Google Generative AI, and Vercel AI Gateway key variables were
absent, and no local Ollama executable was available. No provider credential
was requested or read, no paid request was made, and no synthetic score was
substituted. The model-backed gate therefore remains explicitly unproven until
a backend is deliberately authorized and the raw outcomes are retained.

## Full journeys

The release candidate must also be tested in a supported browser for these
complete journeys:

- direct place query → evidence → visible map and Insight update;
- ambiguous place → user choice → coordinate follow-up → evidence;
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
