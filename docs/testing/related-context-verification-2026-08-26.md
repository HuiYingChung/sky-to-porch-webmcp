# Related-context verification — 2026-08-26

## Candidate behavior

The primary WebMCP tool now defaults Agent requests to `related_context`.
`single_hazard_only` is valid only when the person's request explicitly limits
the evidence to one hazard. Product-owned default combinations are:

- Wind & Storm + Flood & Heavy Rain;
- Extreme Heat + Drought & Land;
- Fire & Smoke + Air Quality;
- Earth & Volcanoes + Air Quality + Extreme Heat.

An Agent may add hazards named or strongly implied by a broader question. The
total bundle is bounded to one primary and at most three related chains. The
relationship table is non-recursive.

Independent requests execute in parallel under one abort controller and one
stale-generation guard. The shared view commits once, showing the primary
result followed by separately labelled related evidence. Tool and UI copy use
`co_occurring_context_not_causation`; one chain cannot repair, substitute for,
or causally explain another chain.

## Deterministic verification

All checks passed against the working tree on 2026-08-26:

- TypeScript: `npx tsc --noEmit`;
- lint: `npm run lint`, no warnings or errors;
- unit: `npm test`, 69 files and 1,270 tests passed;
- integration: `npm run test:integration`, 10 files and 132 tests passed;
- production build: `npm run build`, 14 application routes generated;
- browser: `npx playwright test` on isolated port 3110, 224 desktop/mobile
  journeys passed;
- secret scan: `npm run secret-check`, no potential secrets found;
- patch hygiene: `git diff --check` passed.

The browser suite includes direct WebMCP execution for:

1. an explicitly narrow Fire & Smoke request, proving the one-chain exception;
2. a broad Phoenix Heat question, proving automatic Drought retrieval and a
   separate visible context section;
3. a broad Hilo Volcano question, proving automatic Air Quality and Extreme
   Heat retrieval and two separate visible context sections.

The first targeted Playwright attempt tried the configured port 3000, which was
already occupied by the user's localhost process, and therefore did not reach
product assertions. Targeted and full tests were rerun successfully on isolated
ports without stopping or reusing that process.

## Claims not established by this record

- No model-backed tool-selection evaluation was run.
- No supported release-browser WebMCP Agent was used.
- No live external source smoke was run for the new bundle orchestration; the
  browser journeys use deterministic internal route responses.
- No deployment, push, pull request, merge, or public submission was performed.
