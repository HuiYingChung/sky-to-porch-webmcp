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

## Remaining release evidence

This local record does not claim PR CI, a deployed commit, or native production
success. After merge and deployment, production must be checked separately for:

1. discovery of the nullable `place_choice_id` schema;
2. distinguishable Houston city/county labels and stable IDs;
3. wait after ambiguity with no UI update;
4. original `Houston` plus the chosen ID completing the Beryl analysis;
5. shared map/evidence UI update and a final Agent answer.
