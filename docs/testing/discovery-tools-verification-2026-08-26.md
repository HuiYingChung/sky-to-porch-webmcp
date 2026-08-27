# WebMCP discovery tools verification — 2026-08-26

## Candidate

- Branch: `feat/related-hazard-context`
- Implementation commit:
  `43ca72528ff1896948cfa3cfe68dcda9f2840bc1`
- Commit subject: `feat: add bounded WebMCP discovery tools`
- Worktree state before the exact-candidate gate: clean

## Verified behavior

The page registers three baseline tools under one abort lifecycle:

1. `analyze_environmental_hazard`;
2. `list_environmental_hazards`;
3. `get_environmental_source_coverage`.

The primary tool directs a concrete place-and-hazard question straight to
analysis. The two discovery tools are read-only, make no live request, do not
update the shared UI, and do not form a mandatory preflight sequence.

The hazard catalog returns all seven governed hazards, six concern contexts,
the default related-context relationships, and the non-causation boundary. The
coverage tool reads `src/data/source-coverage.ts`, which also powers the human
About UI. Hazard summaries include every registered source. An optional
`source_id` returns one detailed profile with its official documentation URL.
Every coverage response states that it is pipeline eligibility rather than an
observation and that no live source was queried.

All hazard summaries and every registered single-source detail remain within
the 1,500-character output cap. Unknown fields, invalid hazards, missing
hazards, and source IDs that do not belong to the selected hazard fail closed.
If any baseline registration fails, the shared signal is aborted so a partial
tool surface is not left registered.

After validated page state exists, the pre-existing contextual registrations
remain unchanged: current-evidence inspection is available for a completed
analysis, and claim-discussion preparation is available only for Home + Wind.

## Exact-candidate gate

The following gate ran against commit `43ca725` with the Playwright production
server isolated on `localhost:3113`:

    npm run verify

Results:

- TypeScript typecheck: pass.
- ESLint: pass with no warnings or errors.
- Unit suite: 70 files, 1,277 tests passed.
- Integration suite: 10 files, 132 tests passed.
- Production build: pass; 14 of 14 pages generated.
- Playwright: 224 desktop/mobile journeys passed.
- Secret scan: pass; no potential secrets found.

The browser journeys prove application-owned registration, execution, compact
discovery output, the coverage-versus-observation contract, direct primary-tool
execution, shared-view updates, and existing related-context behavior with the
deterministic `document.modelContext` test double.

## Evidence boundary

This record does **not** claim:

- native discovery or execution in a challenge-supported browser;
- correct tool selection or arguments by a real Agent model;
- a live-source/provider pass;
- CI, preview, production, or deployment behavior;
- remote repository publication or public availability.

The checked-in selection dataset now includes capability-only and
coverage-only prompts plus direct-analysis prompts, but it remains a
deterministic dataset contract until model-backed runs are retained. No live
request, provider key, paid API, push, deployment, or public action occurred in
this work package.

## Later contract revision — 2026-08-27

This remains an exact historical record for `43ca725`; its selector and
1,500-character statements are not the current tool surface. ADR-0006 later
removed `demo_id` and `source_id`. The current hazard list takes no input and
returns all three compact demo inputs, while source coverage takes only
`hazard` and returns every compact matching profile. Both now use the shared
2,400-character discovery limit and retain the same read-only,
coverage-is-not-observation boundary.
