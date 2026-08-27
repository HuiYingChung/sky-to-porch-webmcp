# Wind & Storm verification — 2026-08-26

## Candidate boundary

- Branch: `feat/wind-storm-evidence`
- Verification environment: local Windows production build
- Public deployment and challenge-agent verification: not performed

## Deterministic gates

- `npm run typecheck` — passed
- `npm run lint` — passed with no warnings or errors
- `npm test` — 69 files, 1261 tests passed
- `npm run test:integration` — 10 files, 132 tests passed
- `npm run build` — production build passed; `/api/storm/query` included
- `npm run test:e2e` — 220 desktop/mobile Chromium journeys passed
- `npm run secret-check` — passed

## Live localhost WebMCP journey

A temporary browser `document.modelContext` harness registered the actual
production tool and executed this broad question for Houston coordinates on
2024-07-08:

> Could Hurricane Beryl have damaged my home or roof, and what evidence can
> help me discuss a claim with my insurer?

The Agent selected `storm_impacts`. One tool execution ran Flood & Heavy Rain
first and Wind & Storm second. The compact result reported:

- `status: storm_evidence_bundle`;
- `evidence_scope: separate_wind_and_water_chains`;
- a successful `wind_storm` chain labelled
  `wind_only_no_rain_flood_or_water_gages`;
- a successful `flood_storm` chain labelled
  `water_only_no_wind_damage_causation`;
- `claim_discussion_available: true`;
- `water_evidence_visible_in_shared_view: true`.

The visible application showed the Wind result and claim-discussion action
alongside a separate, automatically collected Flood & Heavy Rain section. The
visible date input and selected-area summary both showed the same complete UTC
day, `2024-07-08T00:00:00.000Z` through `2024-07-08T23:59:59.000Z`.

This run proves the local production path and the bounded upstream responses
observed during that run. It does not prove future source availability,
property damage, causation, insurance coverage, a claim outcome, deployment,
or supported-browser Agent behavior.

