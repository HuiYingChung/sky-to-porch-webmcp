# WebMCP final local candidate verification — 2026-08-27

> Superseded for same-label place continuation by
> [Stable place-choice regression verification](webmcp-identical-place-choice-regression-2026-08-27.md).
> This record remains historical evidence for PR #5 and must not be read as
> verification of the later stable-ID fix.

## Candidate and boundary

- Branch: `fix/webmcp-place-choice-evaluation`
- Product commit: `ceb182a`
- Verified PR #5 head: `e00e7c4`
- Exact PR-head CI run `33120305386` passed classification,
  lint/typecheck/unit/integration/secret, production build, and Chromium E2E;
  the Vercel preview status also passed.
- Merge, production deployment, visibility, and production-native behavior
  remain separate and were not inferred from PR or preview checks.
- Production-native evidence remains attached to published commit `c6f3c8c`;
  this record does not transfer that evidence to `ceb182a`.

## Implemented boundary

- Named places cannot carry model-supplied latitude/longitude fields.
- Explicit person-supplied coordinates remain accepted inside `place` as
  `latitude, longitude` and are validated deterministically.
- Ambiguous geocoder results contain label-only choices and require the Agent
  to ask, wait, preserve the unfinished task, then retry with the selected
  label.
- Every analysis call carries one required time intent:
  `latest_completed`, one completed UTC date, or a bounded date range.
- The help/demo and source-coverage tools expose no guessable demo or source
  selectors; their names and descriptions separate missing-hazard help from
  concrete analysis.

## Deterministic exact-candidate gate

The following ran against product commit `ceb182a`:

- TypeScript: pass.
- ESLint: pass with no warnings or errors.
- Unit: 71 files, 1,309 tests passed.
- Integration: 10 files, 132 tests passed.
- Production build: pass; 14 of 14 pages generated.
- Playwright: 230/230 desktop/mobile journeys passed after the sandbox-blocked
  browser spawn was rerun with browser-process permission.
- Secret scan: pass on an exact `ceb182a` tracked-file archive that excluded
  `.env.local` by construction.

The browser suite proves an ambiguous Springfield call runs no evidence query,
the selected Illinois label then runs one analysis, and the shared Agent
receipt/UI updates.

## Improved model-backed evaluation

Product commit `ceb182a` strengthened the tool contract and made the runner
execute the complete post-choice continuation, including the selected-label
tool result and the final safety-bounded answer. The final `gpt-5-mini` gate
used low reasoning for three runs of all 22 selection cases and both multi-turn
ambiguity cases. Raw responses remain locally under the gitignored artifact:
`artifacts/webmcp-evals/2026-08-27T21-43-45.875Z-gpt-5-mini.json`.

- semantic selection and arguments: 66/66;
- exact calls: 18/66;
- expected-argument subset: 51/66;
- asks and waits after ambiguous output: 3/3;
- resumes after the person's Springfield, Illinois choice, executes the tool,
  finishes the answer, and preserves the no-observation safety boundary: 3/3;
- usage: 81 API responses, 91,371 input tokens (21,632 cached) and 12,937
  output tokens;
- estimated cost for the final run: $0.04384955 at the public token rates
  checked on 2026-08-27, excluding account-specific adjustments.

The earlier 18/22 result remains in Git history as a calibration record rather
than being rewritten. Across all 16 strengthening/calibration artifacts created
for this improvement pass, the aggregate public-rate estimate is $0.192591,
well below the owner's $5 authorization.

The initial sandbox Playwright attempt failed at process spawn with `EPERM`;
the permitted browser rerun passed. The ordinary working-tree secret scan
could not classify tracked files inside the sandbox and fail-closed on ignored
`.env.local`; scanning the exact `ceb182a` archive passed without reading that
local file.
