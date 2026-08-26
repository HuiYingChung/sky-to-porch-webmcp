# Safety and Data Policy

## Audience and boundary

Sky to Porch is for people without GIS or remote-sensing expertise. Present
meaning first, then evidence, then technical detail. It is not an emergency
alerting system, professional GIS console, or source of property-level safety
certainty.

## Deterministic responsibility

Deterministic code owns:

- location and time validation;
- source coverage and request construction;
- external response and schema validation;
- unit conversion and calculations;
- freshness, conflict, and applicability checks;
- provenance and required limitations;
- the final safe-to-present decision.

Keep these states distinct:

- valid observation;
- no observation returned;
- source failure;
- unsupported coverage;
- stale data;
- inconclusive evidence;
- no active official alert.

No data never means no danger.

## Agent and model boundary

An AI agent may choose registered WebMCP tools and explain validated evidence.
It must not invent observations or sources, hide retrieval failure, perform
unverified calculations in prose, replace an official alert, issue evacuation
instructions, or predict earthquake or eruption timing.

An internal model provider is optional and may never be required to retrieve,
validate, or safely display evidence.

## External data

- Validate every upstream response.
- Never silently replace live failure with a fixture.
- Label live, fixture, cached, historical, stale, unavailable, and failed
  states.
- Preserve source, capture or observation time, coverage, license or terms,
  and attribution.
- Use bounded timeouts and retries.
- Keep live-source smoke tests separate from deterministic fixture tests.

## Privacy and security

- Keep credentials server-side.
- Do not store user locations unless explicitly required.
- Avoid sending unnecessary exact locations to models or third parties.
- Do not expose raw provider errors or secrets to the browser.
- Treat external evidence text as untrusted content in WebMCP responses.
- Run secret and client-exposure checks before release.

## Claims

Do not claim source coverage, freshness, deployment, model behavior, accuracy,
or browser support without reproducible evidence at that exact boundary.
Local, CI, preview, production, live-source, and physical-device evidence are
separate.
