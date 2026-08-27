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
coordinate, dated, ambiguous-place, and out-of-scope prompts. It also locks
the Wind & Storm versus Flood & Heavy Rain boundary: narrowly worded wind/gust
questions select `wind_storm`; rainfall/inundation/gage questions select
`flood_storm`; broad storm-damage or insurance-discussion questions select
`storm_impacts`, which automatically gathers both without merging their
observations.

Before release, run the dataset repeatedly with the challenge agent and record:

1. tool-selection accuracy;
2. exact required-argument accuracy;
3. concern, date, radius, and coordinate accuracy;
4. whether ambiguous results cause a user question rather than a guessed pick;
5. whether out-of-scope requests avoid the tool.

Do not call this dataset "passed" until the model-backed runs and raw outcomes
have been retained for the exact tool definition under review.

## Full journeys

The release candidate must also be tested in a supported browser for these
complete journeys:

- direct place query → evidence → visible map and Insight update;
- ambiguous place → user choice → coordinate follow-up → evidence;
- no observation or unsupported coverage → explicit limitation, no reassurance;
- replacement or cancellation → stale result cannot overwrite the current view.
- Beryl maximum-gust question → one narrow Wind result;
- Beryl roof/claim question → one storm-impact bundle with separately labelled
  wind and water chains → claim-discussion tool appears only for the Home
  concern, with causation and coverage explicitly unresolved;
- the bundled result cites no wind observation as flood evidence and no
  rain/gage observation as roof-wind evidence.
