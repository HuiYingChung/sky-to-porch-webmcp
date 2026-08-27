# WebMCP Evaluation Boundary

## Deterministic gates

The automated unit and browser tests verify facts owned by the application:

- tool schema and annotations;
- strict argument validation;
- place ambiguity without silent guessing;
- cancellation and registration lifecycle;
- shared map and evidence state;
- compact output and explicit no-data safety language.

These tests do not prove that a language model will select the right tool.

## Agent-selection dataset

`tests/webmcp/tool-selection-evals.json` follows the current Chrome WebMCP
`messages` plus `expectedCall` examples. It includes direct, implicit,
coordinate, dated, ambiguous-place, and out-of-scope prompts. It locks the
scope rule: an explicitly narrow gust, gage, temperature, fire, or air-quality
question selects `single_hazard_only`; a broad question leaves the default
`related_context` in force. Broad examples cover Wind with Flood, Heat with
Drought, Fire/Smoke with Air Quality, and Volcanoes with Air Quality and Heat.
The tool then runs the governed combination without merging observations or
causation.

Before release, run the dataset repeatedly with the challenge agent and record:

1. tool-selection accuracy;
2. exact required-argument accuracy;
3. concern, date, radius, and coordinate accuracy;
4. whether ambiguous results cause a user question rather than a guessed pick;
5. whether out-of-scope requests avoid the tool.
6. whether `single_hazard_only` appears only for an explicitly restricted ask;
7. whether named or strongly implied extra hazards are included without
   exceeding the bounded related-chain limit.

Do not call this dataset "passed" until the model-backed runs and raw outcomes
have been retained for the exact tool definition under review.

## Full journeys

The release candidate must also be tested in a supported browser for these
complete journeys:

- direct place query → evidence → visible map and Insight update;
- ambiguous place → user choice → coordinate follow-up → evidence;
- no observation or unsupported coverage → explicit limitation, no reassurance;
- replacement or cancellation → stale result cannot overwrite the current view.
- Beryl maximum-gust question → one `single_hazard_only` Wind result;
- Beryl roof/claim question → one related-context bundle with separately labelled
  wind and water chains → claim-discussion tool appears only for the Home
  concern, with causation and coverage explicitly unresolved;
- the bundled result cites no wind observation as flood evidence and no
  rain/gage observation as roof-wind evidence.
- Heat question → independent Heat and Drought chains;
- Fire/smoke question → independent Fire/Smoke and Air Quality chains;
- Volcano context → independent Earth/Volcano, Air Quality, and Extreme Heat
  chains, labelled as co-occurring context rather than causal attribution.
