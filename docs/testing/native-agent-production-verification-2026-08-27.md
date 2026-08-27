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
- the correction has not been pushed, deployed, or rerun in production.

Therefore production proves the corrected one-argument callback and the full
native journeys at `5cc1098`, while the 2,400-character inspection contract is
only locally corrected until a separately authorized publication and
production re-verification occur.
