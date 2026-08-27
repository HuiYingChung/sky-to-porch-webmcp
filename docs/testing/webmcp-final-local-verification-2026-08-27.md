# WebMCP final local candidate verification — 2026-08-27

## Candidate and boundary

- Branch: `main`
- Product/documentation commit: `b3859f9405ccdc387fb2cc35bfc304ee548537e6`
- Repository state at the gate: clean; ten local commits ahead of `origin/main`
- No push, deployment, visibility change, or submission occurred.
- Production-native evidence remains attached to published commit `c6f3c8c`;
  this record is local exact-candidate evidence only.

## Implemented boundary

- Named places cannot carry model-supplied latitude/longitude fields.
- Explicit person-supplied coordinates remain accepted inside `place` as
  `latitude, longitude` and are validated deterministically.
- Ambiguous geocoder results contain label-only choices and require the Agent
  to ask, wait, preserve the unfinished task, then retry with the selected
  label.
- Every analysis call carries one required time intent:
  `latest_completed`, one completed UTC date, or a bounded date range.
- The list and source-coverage tools no longer expose guessable demo or source
  selectors.

## Deterministic exact-candidate gate

The following ran against `b3859f9`:

- TypeScript: pass.
- ESLint: pass with no warnings or errors.
- Unit: 70 files, 1,294 tests passed.
- Integration: 10 files, 132 tests passed.
- Production build: pass; 14 of 14 pages generated.
- Playwright first full run: 229/230 passed; one unrelated existing Heat-layer
  checkbox did not toggle under six-worker concurrency.
- The failed Heat case passed alone, then the complete suite was rerun with
  four workers: 230/230 passed.
- Secret scan: pass on a `git archive` tracked-file snapshot of `b3859f9`.
  The archive has no `.git`, so the scanner reported Git enumeration
  unavailable and scanned the complete extracted tree instead. `.env.local`
  was never present in that snapshot; Git independently reports it ignored by
  `*.env.local` and not tracked.

The browser suite includes the new desktop and mobile journey that proves an
ambiguous Springfield call runs no evidence query, the selected Illinois label
then runs one analysis, and the shared Agent receipt/UI updates.

## Model-backed evaluation

The final-schema baseline used `gpt-5-mini`, one run of all 22 selection cases,
and both multi-turn ambiguity cases. Raw responses remain locally under the
gitignored artifact:
`artifacts/webmcp-evals/2026-08-27T20-36-49.746Z-gpt-5-mini.json`.

- semantic selection and arguments: 18/22;
- exact calls: 6/22;
- expected-argument subset: 10/22;
- asks and waits after ambiguous output: pass;
- resumes after the person's Springfield, Illinois choice with
  `time=latest_completed`: pass;
- usage: 25 API responses, 24,666 input tokens (2,048 cached) and 1,927 output
  tokens.

The four semantic misses remain release-visible: two single-hazard questions
were expanded to related context, one no-hazard question guessed Air Quality
instead of asking, and one direct Volcano question called discovery first.
Therefore the deterministic gate passes, the requested ambiguity behavior
passes, and the overall model-selection gate remains partial rather than
passed.
