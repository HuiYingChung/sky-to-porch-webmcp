# NCEI streamed-archive OOM verification — 2026-09-03

## Candidate and evidence boundary

- Branch: `fix/ncei-streaming-oom`
- Base and failing production commit:
  `92f1909c92a35034ada2ee030ebf77c96d4c0e4d`
- Local archive: `StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz`;
  the archive remains outside the repository.
- Production incident evidence, local deterministic evidence, local real-file
  evidence, and any later production rerun are separate claims.

## Production incident evidence

On 2026-09-03, `POST /api/storm/query` and `POST /api/flood/query` on
`https://sky-to-porch-webmcp.vercel.app/` returned Vercel platform HTML HTTP
500 responses. Four runtime log entries for deployment
`dpl_6UBidwgC4mFx3XSLai2CVmXPmqoD`, commit `92f1909`, reported
`Vercel Runtime Error: instance was killed because it ran out of available
memory`. `/api/health` and the Air route returned HTTP 200 as controls.

This proves that the deployed buffered NCEI path exhausted production memory.
It does not prove that the local streaming candidate works in production.

## Local deterministic gate

`npm run verify` passed on the final candidate:

- typecheck passed with no diagnostics;
- lint passed with no warnings or errors (Next.js printed its `next lint`
  deprecation notice);
- 76 unit-test files and 1,424 tests passed;
- 10 integration-test files and 133 tests passed; the two real-file tests were
  skipped without their opt-in local archive environment variable;
- the Next.js 15.5.22 production build generated all 14 static pages;
- all 234 Playwright desktop/mobile journeys passed; and
- the repository secret check passed. Its only warning referred to the
  untracked handoff note, which is excluded from the candidate commit.

The focused NCEI streaming suite passed 62 tests. Its coverage includes all 29
planned CSV chunk-boundary cases, split UTF-8 and BOM handling, malformed
input, live logical-record and column guardrails, compressed and decompressed
byte limits without relying on `Content-Length`, index streaming bounds,
transport and timeout classification, reader cancellation, schema checks,
no-partial-data behavior, and unchanged Wind/Flood filtering.

An independent adversarial review found no release-blocking correctness issue
after these checks. The exported whole-text parser remains unbounded for
existing callers and retains its prior semantics; only the network streaming
path applies the new per-record guardrails.

## Local real-file identity, equivalence, and memory

The opt-in real-file suite and diagnostic comparison used one fingerprinted
official 2024 archive:

- gzip: 12,693,243 bytes, SHA-256
  `2070b83eccab041b36360ab73645b9a249c3eefc5b92b5b3fc0cbba4d9fcc09c`;
- decompressed CSV: 69,861,911 bytes, 69,802 rows of 51 columns, SHA-256
  `e278ecef5b99b6b7a5bfdeff0e7b75da1b14f36a0c893f272c9afb92abf7f3e3`.

| Path | Wind 2024-05-16 | Wind 2024-07-08 | Flood 2024-05-16 | Local peak memory |
| --- | --- | --- | --- | --- |
| Buffered legacy | 12 observations, 2.435 s | 0 observations, 3.782 s | 0 observations, 3.469 s | heap used 1,628.3 MB; RSS 2,218 MB |
| Streaming candidate | 12 observations, 0.402 s | 0 observations, 0.426 s | 0 observations, 0.455 s | sampled heap 49.4 MB; RSS 178 MB |

The streaming phase of the final diagnostic run was launched with
`NODE_OPTIONS=--max-old-space-size=256`; its isolated legacy comparison child
used a 4,096 MB old-space limit. After omitting only
`provenance.retrievedAt`, all three streamed results were deeply equal to the
frozen legacy adapter results and retained the same full-payload hash. The new
whole-text parser also emitted all 69,802 rows identically to the legacy
parser. The legacy snapshot and diagnostic benchmark were removed before the
candidate was committed.

The shipped opt-in real-file test no longer performs a whole-file comparison
inside its constrained process. It streams both hashes, byte and row counts,
the complete fixed header, and three semantic query anchors. The full two-test
file passed under the same 256 MB old-space option in 2.48 seconds; its three
sequential queries sampled 26 MB peak JavaScript heap and 119 MB maximum RSS.

These numbers are local process measurements. They do not establish Vercel
function memory, latency, concurrency behavior, or production recovery.

## Production repair status — pre-deploy boundary

At the time of this candidate record, the repair had not been deployed or
rerun against the production routes. No production success or production
memory reduction is claimed. A later deployment check must record the exact
commit and deployment, both route responses, runtime memory/log evidence, and
the supported-browser Judge quick-start journey without replacing this
pre-deployment boundary.

## Production post-deploy verification — 2026-09-03/04

The repair was merged in pull request #13 as merge commit
`07096ef91bd482c600f263ddd98ee5e9d97f898c`. Vercel deployment
`dpl_2Zfn2axorbunWVSL1LiHgt5Soeta` reached `READY` for `main` at that exact
Git SHA and serves the production alias
`https://sky-to-porch-webmcp.vercel.app/`.

The Houston 50 km production reruns were performed at 2026-09-04 01:22–01:23
UTC (2026-09-03 20:22–20:23 CDT):

| Route | Input | Result | Client elapsed | Vercel invocation | Fluid memory |
| --- | --- | --- | --- | --- | --- |
| `POST /api/storm/query` | 2024-07-08 | HTTP 200, JSON `ok: true`, observations returned | 2.948 s | 2.46 s | 473 MB |
| `POST /api/flood/query` | 2024-07-08 through 2024-07-08 | HTTP 200, JSON `ok: true`, observations returned | 3.213 s | 2.83 s | 345 MB |

The NCEI Storm Events source legitimately returned `no_observation` for that
date and box; the successful Wind result retained its other evidence sources.
The Flood result returned three observations. Copying the Storm request body
verbatim to the Flood route first produced HTTP 400 `invalid_input`, because
the Flood contract requires `startDate` and `endDate` rather than `date`; the
corrected request above passed. That validation response was not an OOM or
route failure.

Vercel request details tied both HTTP 200 invocations to the deployment above,
production, and `main`. A post-`READY` production log scan showed both 200
responses and the expected 400 validation response, with no HTTP 500, runtime
error, or OOM entry for either route. Settings > Functions showed Fluid Compute
enabled, and Observability > Functions independently reported the same state.
The measured 345 MB and 473 MB invocations completed without exhausting the
production instance. They are Vercel's whole-invocation Fluid memory
measurements; the greater-than-2 GB figure above is the separate local legacy
RSS measurement, so the two are not treated as identical metrics.

README Judge quick-start step 1 was attempted from a logged-in ChatGPT Free
session after opening the production site from the chat. ChatGPT replied that
it could access the site but did not have access to the site's WebMCP tool
interface, so the required Agent return with linked Wind and Flood results was
**not verified in that environment**. Both the Codex in-app browser and the
controlled Chrome page likewise exposed the site's explicit `Agent
unavailable` status. No successful WebMCP claim is made for those sessions.

A later owner-run verification in a WebMCP-compatible Chrome environment
passed the functional Judge quick-start step 1 at 2026-09-04 02:12--02:17 UTC.
The exported tool transcript records the exact README prompt, followed by an
initial `analyze_environmental_hazard` call with `wind_storm`,
`related_context`, 50 km, and `2024-07-08`. The tool paused for the ambiguous
Houston place choice; after option 1 was selected, the Agent retried with
`place-osm-r-2688911` while preserving the original arguments. The completed
`related_environmental_evidence_bundle` reported `ui_updated: true`, four
official sources, no failed or incomplete source checks, and both included
chains: `flood_storm` and `wind_storm`. The final response separately reported
Flood & Heavy Rain as inconclusive evidence and Wind & Storm as observations
returned, including each chain's confidence, strongest evidence, time, source,
and limitation.

This verifies the README-permitted WebMCP-compatible-browser route, the
generic-storm two-chain bundle, and the shared-view update. The export identifies
the browser Agent model as `gemini-3.6-flash`, not ChatGPT's in-app Agent, and
does not contain the tab URL; production-host attribution therefore relies on
the owner's test statement. It also records `ui_updated: true` but does not
visually prove the rendered links. Later `RegisteredTool` errors in the export
belong to a separate August 2026 comparison request and are not included in
this Judge-step pass.

As a browser fallback, the production human UI completed both Houston example
journeys in the same session. Wind & Storm (July 8) displayed `Observations
returned` with three sources and 18 limitations; Flood & Heavy Rain (July 8–9)
displayed `Observations returned` with three sources and 19 limitations. This
confirms the production browser-to-route-to-result path for both products, but
does not replace the blocked WebMCP Agent check.

## 2026-08-30 expansion boundary

The expanded evidence-chain record from 2026-08-30 documents a local
deterministic gate and local live-source smoke. Those expansion journeys were
not separately verified in production. The expansion code's later presence in
a deployed commit does not convert that local evidence into production
verification.
