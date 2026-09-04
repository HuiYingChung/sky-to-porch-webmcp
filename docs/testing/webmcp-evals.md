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
support an inference. A dedicated Houston 2026-08-28 regression asks only
whether there was a storm; it must preserve the original question and select
`wind_storm` with `related_context`, causing separate wind and water retrievals.

`tests/webmcp/post-tool-behavior-evals.json` separately captures four multi-turn
place cases plus a generic-storm final-response case. The place cases cover wait
and resume for ordinary Springfield choices, plus wait and stable-ID resume when
Houston candidates can share a display label. After an ambiguous
tool result, the model must ask the person to choose, make no second tool call,
select no candidate, and wait for the next user message. On reply it must keep
the original place query, copy the selected `choice_id`, preserve the exact
retry arguments, execute the analysis, and finish the answer. Its deterministic
test validates the retained scenarios and contract. The storm case requires an
overall plain-English summary followed by both Wind & Storm and Flood & Heavy
Rain, each with status, strongest evidence, time, source, and limitation. It
also rejects internal hazard IDs, result field names, and enum values in the
person-facing response.

The dataset also includes post-analysis state for
`inspect_current_environmental_evidence` and the Home + Wind-only
`prepare_storm_claim_discussion`. All six stable tool definitions are presented
in every selection case, including before a result exists, so the two
state-dependent actions are tested as real distractors instead of disappearing
from the simulated registry. Every tool must have a paraphrase family with at
least three semantically equivalent requests: a question, an imperative, and a
conversational ask. Each family preserves the same expected call and state
prerequisite while changing the surface wording, and the runner reports results
per family using exact-call matching so aggregate accuracy cannot hide a tool
that only recognizes one phrase or supplies an invalid call. Family summaries
are calculated against the complete checked-in family: focused `--case` runs
are marked incomplete and list every missing case, style, and run. Non-demo
analysis questions must cover all seven hazard families so
curated prompts cannot mask a generic-query regression.

Before release, run the dataset repeatedly with the challenge agent and record:

1. tool-selection accuracy;
2. exact required-argument accuracy;
3. concern, required time intent, radius, and explicit-coordinate-text accuracy;
4. whether ambiguous results cause a user question rather than a guessed pick;
5. whether out-of-scope requests avoid the tool.
6. whether `single_hazard_only` appears only for an explicitly restricted ask;
7. whether named or strongly implied extra hazards are included without
   exceeding the bounded related-chain limit.
8. whether capability questions select `get_sky_to_porch_help_and_demos` without
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
14. whether all three phrasings in every tool's paraphrase family select the
    same intended tool, and whether no tool is merely called to increase the
    visible tool count;
15. whether non-demo questions across all seven hazards preserve the same
    answer order and shared UI update as curated demos.
16. after `needs_place_choice`, whether the model asks the person to choose and
    produces no second tool call until a new user message arrives.
17. whether an unqualified storm, thunderstorm, or severe-weather question runs
    separate Wind and Flood context chains instead of narrowing to Wind alone.
18. whether every related-context final answer reports every included chain in
    plain English, beginning with an overall summary and preserving each
    chain's evidence and limitation.

Do not call this dataset "passed" until the model-backed runs and raw outcomes
have been retained for the exact tool definition under review.

## Execution status

The current 38-case selection dataset contains six three-utterance paraphrase
families, one for every registered tool. These cases are deterministic coverage
until the exact suite is run with a model; no current six-tool paraphrase pass
is claimed yet.

The retained 2026-08-27 model-backed result covers the prior 22-case dataset
and four multi-turn ambiguity cases. The owner authorized paid OpenAI
evaluation with a key stored only in gitignored `.env.local`. The runner loads
the key without logging or retaining it, sends only public eval prompts and
tool metadata, and writes raw responses under ignored
`artifacts/webmcp-evals/`.

On 2026-08-29, the Houston generic-storm regression increased the selection
dataset to 23 cases. Its deterministic contract test is part of the local gate;
the full 23-case model-selection suite has not been rerun, so no new full-suite
selection score is claimed for this change.

The new post-tool storm-summary case was run independently three times against
the exact final result contract using `gpt-5-mini`, low reasoning, and low text
verbosity. Raw artifact:
`2026-08-29T23-29-29.572Z-gpt-5-mini.json`.

- complete two-chain reporting: **3/3**;
- plain-English wording without internal hazard IDs or status enums: **3/3**;
- overall summary first: **3/3**;
- evidence time, official source, and limitation included: **3/3**;
- API usage: 3 responses, 4,911 input tokens (3,072 cached) and 973 output
  tokens;
- estimated cost: **$0.00248255** at the retained public-rate basis.

Six earlier calibration artifacts exposed that the first scorer accepted
internal status codes and that a human-readable chain name alone did not
reliably prevent those codes from appearing. Later runs distinguished actual
summary omissions from harmless ISO-date and short request-lead-in phrasing.
The final contract therefore supplies human-readable chain names,
plain-English status summaries, and a deterministic overall summary. All seven
targeted runs together used an estimated **$0.01475285**, below the
owner-authorized $3 limit. Calibration artifacts remain diagnostic evidence,
not release passes.

A separate bounded live-source smoke used the local product routes for the
Houston 2026-08-28 regression at the known 50 km selected area. This is live
adapter evidence, not a native WebMCP browser proof or deployment claim.

- Flood & Heavy Rain returned `inconclusive_evidence` with two validated live
  observations: NASA GIBS IMERG and NASA LANCE flood extent;
- the source outcomes were IMERG `success`, flood extent `success`, USGS
  `no_observation`, and Canada `not_attempted`;
- Wind & Storm returned `no_observation` with zero observations;
- both local route calls returned HTTP 200 and no fixture fallback was used.

The mixed result is the intended regression boundary: available water-chain
evidence must remain visible even when the independent wind chain is empty.
It does not turn the satellite products into measured rainfall depth or a
street/property flooding claim.

Several calibration runs were deliberately retained. They exposed guessed
coordinates, optional-date invention, discovery-selector guessing, and one
overly permissive continuation scorer. Those findings caused the selector-free
discovery surface, stable place IDs, distinguishable locality/type labels,
removal of public coordinate fields, required `time` intent, exact retry
arguments, and semantic continuation scoring in ADR-0006. Failed calibration
scores are not release evidence.

The stable-place candidate used `gpt-5-mini` with low reasoning and low text
verbosity for three complete, independent runs. Raw artifact:
`2026-08-27T23-32-18.065Z-gpt-5-mini.json`.

- semantic tool selection and arguments: **66/66** (22 cases x 3 runs);
- exact calls: **20/66**;
- expected-argument subset: **53/66**;
- ambiguity wait and selected-place resume journeys: **12/12**
  (4 cases x 3 runs);
- resumed analyses executed the selected stable ID for Springfield and Houston,
  produced a final answer, and retained the boundary that missing observations
  do not prove safety;
- API usage: 88 responses, 113,101 input tokens (74,368 cached) and 13,610
  output tokens;
- estimated API cost at the public `gpt-5-mini` token rates checked on
  2026-08-27: **$0.03876245**; account-specific billing adjustments are not
  included.

Exact-string and expected-subset counts remain diagnostics rather than the
release score: the semantic scorer permits harmless place qualifiers, natural
question wording, and additional optional arguments while still rejecting
invented coordinates/dates, wrong hazards/scopes, extra tool calls, unsafe
missing-data conclusions, or a failure to ask and wait. The semantic scorer
has 25 deterministic unit tests.

The earlier 18/22 artifact remains a retained calibration record. Its four
misses led to sharper single-versus-related hazard descriptions, a dedicated
missing-hazard help contract, contextual place extraction, and explicit
concern mapping. Application-owned schema, execution, and browser tests remain
separate from these now-passing model-selection outcomes.

## Full journeys

The release candidate must also be tested in a supported browser for these
complete journeys:

- direct place query → evidence → visible map and Insight update;
- Houston 2026-08-28 generic storm query → one related-context transaction with
  separate Wind and Flood chains; an attempted wind lookup with no matching
  requested-date row is labelled `no_observation`, not unsupported geography;
- generic Wind calls that omit the person's question → fail open to the same
  separate Wind and Flood chains at 1, 25, 50, and 250 km without changing the
  requested geometry;
- every multi-chain Agent receipt → visible summary for every completed chain
  plus a button that opens and focuses that exact chain; the Agent conversation
  reports the same complete bundle in plain English;
- ambiguous place → user choice → stable-ID follow-up → evidence;
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
