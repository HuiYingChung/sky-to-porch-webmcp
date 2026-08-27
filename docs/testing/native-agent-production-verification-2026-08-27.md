# Production native WebMCP verification — 2026-08-27

## Evidence boundary

This is a later, additive record. It does not rewrite the earlier failure and
local-correction evidence in
[`native-agent-acceptance-2026-08-27.md`](native-agent-acceptance-2026-08-27.md).

- Production alias: `https://sky-to-porch-webmcp.vercel.app/`
- Deployed Git head: `5cc10983b3ae46e446c4fa483bff54f63387f7e1`
- Vercel deployment: `dpl_CGznNajNTAQ8nnMkcX1cwck4tMNw`, `READY`
- Matching post-merge GitHub Actions run: `33055412709`, passed
- Supported native surface: the ChatGPT/Codex in-app browser WebMCP
  capability, without a `document.modelContext` test double
- Production HTTP checks: `/` returned 200 and `/api/health` returned a healthy
  response
- The GitHub repository remained private throughout this verification
- No push, deployment, alias change, provider credential, paid model request,
  visibility change, video publication, or Devpost submission occurred

Named tool calls with recorded arguments prove native discovery and execution.
They do not prove repeated model selection by an independent language model.

## Baseline discovery

The production page displayed `Agent ready` and exposed exactly three baseline
tools:

1. `analyze_environmental_hazard`;
2. `list_environmental_hazards`;
3. `get_environmental_source_coverage`.

`list_environmental_hazards({})` returned seven hazards, seven concerns, three
curated demo entrances, `default_analysis_scope: related_context`, and
`ui_updated: false`.

`get_environmental_source_coverage({ hazard: "wind_storm" })` returned three
eligible sources and preserved both
`coverage_scope: pipeline_eligibility_not_observation` and
`actual_observation_not_established: true`. It made no observation or live-query
claim.

## Beryl related-context journey

The primary production call used:

```json
{
  "place": "Houston, Texas, United States",
  "hazard": "wind_storm",
  "analysis_scope": "related_context",
  "concern": "home",
  "latitude": 29.7604,
  "longitude": -95.3698,
  "radius_km": 25,
  "start_date": "2024-07-08",
  "end_date": "2024-07-08",
  "question": "Could Hurricane Beryl have damaged my home or roof, and what official environmental evidence can help me discuss it with my insurer?"
}
```

The native call returned `related_environmental_evidence_bundle` with
`ui_updated: true`, two successful independent chains, five total sources,
`assessment_confidence: moderate`, and
`claim_discussion_available: true`. The page synchronized the Houston
selection, selected map area, Agent receipt, primary Wind Meaning/Evidence,
and separately labelled Flood & Heavy Rain context. No console warning or error
was observed.

After the result committed, native discovery added both contextual tools.

### Current-evidence inspection

`inspect_current_environmental_evidence({})` returned the actual peak wind gust
of 39.6 m/s at `2024-07-08T14:35:00Z`, a related Flood chain, and official NOAA,
NWS, and NASA citations. It also exposed a release defect: the serialized JSON
was 2,834 characters, exceeding the implementation's declared 2,400-character
context-tool limit.

The observation, chain separation, and citations were correct, but this result
must not be called fully conformant to the bounded-output contract.

### Claim-discussion context

`prepare_storm_claim_discussion({})` returned 1,499 characters,
`ui_updated: true`, and opened the visible discussion guide. It retained a
moderate evidence assessment, the 39.6 m/s gust and 25.7 m/s wind-speed
observations, property-specific questions, a document checklist, official
guidance links, and the non-adjudicative boundary.

## Narrow and safety-boundary journeys

An explicitly narrow Houston gust question used
`analysis_scope: single_hazard_only`. It returned one successful Wind result,
39.6 m/s gust and 25.7 m/s wind speed, three observations, two sources, and
`ui_updated: true`. No related-evidence section appeared and only the inspection
contextual tool registered.

A Springfield request returned `needs_place_choice`, `ui_updated: false`, and
three card-ready choices for Massachusetts, Illinois, and Missouri. It did not
guess, and it did not replace the previous Houston UI state.

An Earth & Volcanoes request within 1 km of Tucson on 2024-07-08 returned
`no_observation`, an empty observation list, insufficient confidence,
`no_data_is_not_no_danger: true`, and `ui_updated: true`. The visible page kept
the same explicit safety boundary. No browser warning or error was observed.

## Local correction after the production finding

The current private worktree adds structured compaction stages to
`inspect_current_environmental_evidence`: it first removes duplicate citations,
then compacts citations and related chains, and finally retains a minimal
evidence object if needed. A production-sized regression requires the result to
remain at or below 2,400 characters while keeping the primary observation, the
related hazard chain, and one citation per hazard for the recorded Beryl shape.

The private correction evidence is:

- the complete local gate passed: TypeScript typecheck, ESLint, 70 unit files
  with 1,289 tests, 10 integration files with 132 tests, the production build
  with 14 of 14 pages generated, 228 desktop/mobile Playwright journeys, and
  secret check;
- the clean local candidate passed the mechanical preflight over every commit
  and unique path/blob pair reachable from that candidate;
- the correction has not been pushed, deployed, or rerun in production.

Therefore production proves the corrected one-argument callback and the full
native journeys at `5cc1098`, while the 2,400-character inspection contract is
only locally corrected until a separately authorized publication and
production re-verification occur.

## Post-push exact-candidate verification

The owner subsequently pushed the prepared private candidate. Vercel's Git
integration deployed it automatically; Codex did not run a manual deploy or
change repository visibility.

- Git head: `c6f3c8ceeac582949f8a9dccdfa3058e73b72673`
- Remote `main`: exact match to that head
- GitHub Actions run: `33105415851`, all four jobs passed, including Chromium
  E2E smoke
- Vercel deployment: `dpl_26ghpL9bcDWUeS8TEZ2ktJdv6bgo`, `READY` and
  `PROMOTED`
- Immutable deployment URL:
  `https://sky-to-porch-webmcp-k8jo0s24r-huiyingchungs-projects.vercel.app`
- Production alias: `https://sky-to-porch-webmcp.vercel.app/`
- Vercel `gitSource.sha`: exact match to `c6f3c8c`
- `/` and `/api/health`: HTTP 200
- Repository visibility: still private

The supported in-app browser exposed the same three baseline tools. A native
Beryl related-context call again synchronized Houston, Wind & Storm, Flood &
Heavy Rain, and the claim discussion with no browser warning or error.

The contextual correction is production-conformant:

- `inspect_current_environmental_evidence`: 2,219 serialized characters,
  retaining the 39.6 m/s wind gust, separate Flood chain, and NOAA/NASA
  citations;
- `prepare_storm_claim_discussion`: 1,499 characters and `ui_updated: true`.

The same exact production rerun exposed a second bounded-output defect. The
primary `related_environmental_evidence_bundle` serialized to 2,524 characters,
above `MAX_OUTPUT_CHARACTERS = 2400`. Its evidence and UI synchronization were
correct, but that primary call is not conformant to the declared output cap.

## Local corrections after the exact-candidate rerun

The current private worktree adds staged primary-result compaction. It removes
observations first, then progressively bounds product, limitation, identifier,
place, and URL fields while retaining structured chain status and provenance.
A production-shaped Beryl regression requires both Wind and Flood citations
and a serialized result no longer than 2,400 characters.

The owner also reported that the challenge Agent continued after an ambiguous
place result and selected a candidate instead of asking. Direct tool execution
still returned `needs_place_choice`, `ui_updated: false`, and ran no analysis;
the failure was in Agent continuation behavior. The local contract now:

- tells the Agent never to infer coordinates for a named place;
- returns machine-readable `requires_user_input`,
  `required_next_action: ask_user_to_choose_place_and_wait`,
  `must_not_select_place`, and `must_not_retry_before_user_reply` fields;
- starts the human-readable result with `STOP`, requires a question, and
  requires waiting for a new user message;
- repeats the stop rule in the tool description and coordinate schemas.

The current [WebMCP proposal](https://github.com/webmachinelearning/webmcp)
lists user prompting and elicitation as an area still being explored rather
than a standardized page-owned mechanism that can force the Agent to pause.
This local correction therefore strengthens the model-facing contract and
deterministic no-query boundary, but challenge-Agent compliance still requires
a model-backed or native rerun. A fully enforceable UI-mediated confirmation
gate would change the human workflow and remains a separate product decision.

The current local correction evidence is:

- code and regression commit: `f42cc37`;
- TypeScript typecheck and ESLint pass;
- 70 unit files with 1,292 tests pass, including the production-shaped primary
  bundle and retained post-tool ambiguity scenario;
- 10 integration files with 132 tests pass;
- the production build generates 14 of 14 pages;
- 228 desktop/mobile Playwright journeys pass;
- secret check passes.

One first full-gate attempt had a single failure in the keyboard layer-card
collapse journey; that exact test passed immediately in isolation and the next
complete 228-journey run passed. The failed attempt is retained as an observed
test-run outcome rather than silently treated as a product pass.

The code and tests are committed locally. The evidence-record commit,
clean-candidate preflight, publication, exact remote CI, automatic deployment,
and native/model re-verification remain separate pending evidence.
