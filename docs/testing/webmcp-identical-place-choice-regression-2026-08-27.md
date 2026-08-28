# WebMCP stable place-choice regression verification — 2026-08-27

## Candidate and evidence boundary

- Branch: `fix/webmcp-stable-place-choice`
- Product commit: `72f3a36`
- Base: `origin/main` at `567fe87`
- Repository visibility: private by owner direction
- PR-head CI, merge, post-merge main CI, deployment, and production-native
  behavior are separate and were still pending when this local record was made.

## Production-reported failure

The OpenAI in-app browser returned multiple Houston candidates, asked the
person to choose, then repeated the same ambiguity after each reply. No hazard
analysis ran and `ui_updated` remained false.

The deterministic cause was twofold:

1. Photon returned different OpenStreetMap objects that the old label builder
   collapsed to the same `Houston, Texas, United States` display text.
2. Tool output exposed position-based choice IDs, but the input schema accepted
   only a place label. Retrying that label invoked geocoding again and could not
   identify the selected object.

## Implemented correction

- Geocoder results retain stable OpenStreetMap identity such as
  `osm-r-2688911` and include locality/type context in display labels.
- The analysis schema accepts nullable `place_choice_id`: strict agents use
  `null` on the initial call and copy a returned stable ID only after a person
  chooses.
- Continuation keeps the original place query, re-fetches candidates, resolves
  by stable ID independent of result order, and rejects missing or stale IDs
  without running analysis.
- `needs_place_choice` returns exact original retry arguments, including the
  date and scope, so the Agent can resume and finish the same task.
- A no-observation result includes an explicit required final-answer sentence;
  absence of observations cannot become a no-danger conclusion.

No OpenAI key or internal model route is required by the application or its
deployed WebMCP tools. The key in ignored `.env.local` was used only by the
local model-scored development gate.

## Exact local deterministic gate

The following passed against product commit `72f3a36`:

- TypeScript: pass.
- ESLint: pass with no warnings or errors.
- Unit: 71 files, 1,321 tests passed.
- Integration: 10 files, 132 tests passed.
- Production build: pass; 14 of 14 pages generated.
- Playwright: 230/230 desktop/mobile journeys passed on isolated port 3218.
- Stable-ID WebMCP E2E: ambiguous Houston waits without analysis, then the
  original query plus selected ID runs exactly one analysis and updates the
  shared UI on desktop and mobile.
- Secret gate: pass outside the sandbox. It reported one expected credential
  only in gitignored `.env.local`; a separate tracked-file pattern scan found
  zero matching files.

The sandbox-only secret attempt failed closed because Node could not spawn Git;
the same gate passed with process permission. The browser suite was also run
with browser-process permission because this Windows sandbox blocks browser
spawn with `EPERM`. These were environment boundaries, not product failures.

## Model-scored gate

Final artifact (gitignored):
`artifacts/webmcp-evals/2026-08-27T23-32-18.065Z-gpt-5-mini.json`.

- Model: `gpt-5-mini`, low reasoning, low verbosity.
- Semantic selection and arguments: 66/66 (22 cases x 3 runs).
- Exact calls: 20/66; expected-argument subset: 53/66.
- Ambiguity wait and resume: 12/12 (4 cases x 3 runs).
- Both Springfield and Houston stable-ID continuation execute the selected
  analysis, finish the answer, and preserve the no-observation safety boundary.
- Usage: 88 responses, 113,101 input tokens (74,368 cached), 13,610 output
  tokens.
- Estimated final-run cost: $0.03876245 at the public rates checked on
  2026-08-27, excluding account-specific adjustments.

Exact/subset counts are diagnostics. The release score is semantic because it
permits harmless optional arguments and natural wording while still rejecting
wrong tools, hazards, scope, time, invented coordinates or IDs, premature place
selection, extra calls before the person replies, and unsafe no-data answers.

## Release evidence

The local candidate was published through a separate reviewed path. Each layer
below was checked independently:

- PR: [#6](https://github.com/HuiYingChung/sky-to-porch-webmcp/pull/6).
- Exact PR head: `d53d9bbb6ad7a367f444adb7907180410ca640d7`.
- PR-head CI: run `33127306578`; classification, lint/typecheck/unit/
  integration/secret check, production build, and Chromium E2E all passed.
- Vercel preview status: success.
- Merge commit: `90b8236eb74ea2366905d34d46ce2432b77511b7`.
- Post-merge `main` CI: run `33128144825`; all jobs passed for the exact merge
  commit.
- Vercel production deployment: `dpl_DnNkQ5i91s8hEXsWvqr1JvSZNy4x`, `READY`.
- Immutable deployment URL:
  `https://sky-to-porch-webmcp-jxl18q5y5-huiyingchungs-projects.vercel.app`.
- GitHub deployment `6133096474` and its success status map that production
  deployment to the exact merge SHA.
- The production alias and `/api/health` returned HTTP 200; health reported
  `ai: false`.
- A deployment-scoped error-log query after the live journey returned no error
  logs.
- Repository visibility remained private by owner direction.

## Production native stable-ID journey

The supported in-app browser was reloaded on the production alias before
discovery. The baseline analysis tool exposed nullable `place_choice_id` with
the instruction to use `null` initially and copy only a returned ID after a
person chooses.

The first named call used the original query `Houston`,
`place_choice_id: null`, Wind & Storm, related context, Home, and
`2024-07-08`. It returned:

- `status: needs_place_choice`;
- `ui_updated: false`;
- `requires_user_input: true` and `must_not_retry_before_user_reply: true`;
- `Houston (city), Harris, Texas, United States` with
  `place-osm-r-2688911`;
- `Houston (county), Texas, United States` with
  `place-osm-r-1840945`;
- a separate Houston County, Georgia option.

The continuation kept `place: Houston`, preserved every other argument, and
set `place_choice_id` to `place-osm-r-2688911`. It did not return another
ambiguity. It returned `related_environmental_evidence_bundle`, included the
separate Flood & Heavy Rain and Wind & Storm chains, and set
`ui_updated: true`. The serialized result was 2,110 characters, below the
2,400-character cap.

The visible shared view then showed `Agent updated this view`, the selected
Houston city, July 8, 2024, primary Wind evidence, and separately labelled
Flood evidence. Contextual evidence inspection and claim-discussion tools were
registered after the result.

This production check proves native discovery, stable-ID execution, and shared
UI synchronization with named tool calls. The independent model-selection
claim remains the retained three-run development gate: 66/66 semantic
selection/argument cases and 12/12 ambiguity wait/resume journeys. It is not
misreported as a new judge-side conversational transcript.
