# ADR-0011: Stream and bound bulk source archives

**Status:** Accepted
**Date:** 2026-09-03

## Context

The Wind & Storm and Flood & Heavy Rain live routes both use the NOAA NCEI
Storm Events annual details archive. On 2026-09-03, production requests to both
routes returned Vercel platform HTTP 500 pages, and the deployment logs for
commit `92f1909` reported that the runtime instance was killed after exhausting
available memory.

The deployed adapter buffered the compressed response, synchronously expanded
it, decoded the complete CSV to one string, and materialized every row before
applying the requested date, event-type, and area filters. A local diagnostic
of the 2024 archive—12,693,243 compressed bytes, 69,861,911 decompressed bytes,
and 69,802 rows—measured approximately 1,628 MB of used JavaScript heap and
2,218 MB RSS. The existing 40 MB compressed and 180 MB decompressed limits
bounded accepted input size but did not bound peak parser memory.

## Decision

- Stream the annual gzip response through decompression, fatal UTF-8 decoding,
  incremental RFC-4180 parsing, and row-by-row observation collection. Do not
  retain the full archive, decoded text, or row matrix on the live route.
- Preserve the 40,000,000-byte compressed limit and 180,000,000-byte
  decompressed limit. Enforce both while bytes arrive, including when
  `Content-Length` is absent. Enforce the 1,000,000-byte index limit while that
  small response streams as well.
- Bound a live CSV logical record to 1,000,000 characters and 128 columns. The
  measured 2024 publication has 51 columns and a maximum field length of 7,014
  characters; these guardrails leave substantial publication headroom while
  preventing one record from approaching the whole-file cap in memory.
- Apply the existing date, event-type, exact-area, deduplication, and
  12-observation limits while rows stream. Preserve the existing result and
  failure-stage contract, and return no partial evidence after a transport,
  timeout, size, decoding, schema, or parsing failure.
- Compute provenance SHA-256 incrementally over the complete decompressed CSV,
  so streamed observations retain the same payload identity as the buffered
  implementation.
- Cancel the reader and abort the request on failure. Give the annual archive
  25 seconds for download, decompression, and parsing. Configure the two
  consuming Pro route handlers with a 300-second maximum duration so their
  existing bounded, sometimes sequential source attempts can reach their own
  deterministic timeouts under both legacy and Fluid compute.

## Consequences

- A local real-file benchmark under a 256 MB V8 old-space limit produced
  observations equivalent to the buffered adapter while sampled JavaScript
  heap peaked at 49.4 MB and process RSS peaked at 178 MB. These are local
  measurements, not production runtime measurements.
- The accepted archive byte caps, observation cap, provenance, geographic/date
  boundaries, and fail-closed behavior do not change. The live-only record and
  column guardrails reject structurally hostile CSV before it can amplify
  memory.
- Source latency and availability remain upstream constraints. Raising platform
  memory is not required for this repair and would not replace input or output
  bounds.
- Production recovery and production memory reduction require a separately
  verified deployment; they are not inferred from the local benchmark.
