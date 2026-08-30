# Expanded evidence-chain verification — 2026-08-30

## Scope

Branch: `codex/evidence-chain-expansion`

This record covers the new official-source adapters and the Houston generic
storm regression. Live-source evidence is reported separately from fixture,
build, browser, and model-evaluation evidence.

## Deterministic gate

`npm run verify` passed:

- typecheck and lint;
- 1,362 unit tests;
- 133 integration tests;
- 14-page production build;
- 234 desktop/mobile Playwright journeys;
- secret check, with the local gitignored environment file remaining untracked.

## Credential-free live-source gate

`npm run smoke:evidence-expansion:live -- --approved-live-smoke` passed with no
paid requests and no raw-payload retention.

| Source | Result |
| --- | --- |
| NHC HURDAT2 | 3 validated Hurricane Beryl track observations |
| NOAA MRMS recent QPE | 1 finite validated regional-raster observation |
| NIFC WFIGS | 12 bounded incident/perimeter observations |
| Smithsonian GVP | 1 date-and-area-matched eruption observation |
| Canadian Drought Monitor | Valid request; no observation returned at the selected Toronto point |
| EPA AQS | Server credential gate closed as designed; no request made |

The live gate exposed and verified two schema corrections before passing:
HURDAT2's official `-99` missing-wind value is now skipped rather than failing
the file, and GVP uses the official `GeoLocation` and `StartDate*`/`EndDate*`
fields with one bounded CQL spatial/year filter. MRMS now tests at most four
official regional rasters instead of treating the first Alaska raster as the
answer for Houston.

## Houston generic-storm regression

Request: Houston 50 km area, `2026-08-28`, generic storm.

- The exact supplied bounding box was preserved.
- Wind & Storm completed as a separate result with 3 NWS Local Storm Report
  observations. GHCNh returned no matching station row; NCEI returned no
  matching geolocated event; HURDAT2 was outside its published record.
- Flood & Heavy Rain completed as a separate result with NASA IMERG, NASA LANCE
  flood extent, and NWS Local Storm Report observations. The USGS gage and MRMS
  checks returned no observation for this request.
- Both chain results remained `inconclusive_evidence`, which is intentionally
  different from “no storm” or “safe conditions.”

## Agent summary evaluation

Three low-reasoning model runs passed the focused
`generic-storm-reports-both-chains-plain-english` case three out of three times.
Each final answer reported both Wind and Flood. The full optional evaluation
scored 67/75 semantic tool-selection cases and 14/15 post-tool behavior cases;
estimated API cost was `$0.0502`.
