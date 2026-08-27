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

The application does not call an internal model provider. Evidence retrieval,
validation, deterministic explanation, and safe display require no model key.

## Wind, flood, property, and claim boundaries

- Wind speed, wind gust, and official wind-event context belong to Wind &
  Storm.
- Rainfall, flood extent, inundation, and water-gage evidence belong to Flood &
  Heavy Rain.
- A named storm may appear in both analyses, but the observations remain in
  two machine-labelled evidence scopes and are never merged.
- Regional reports and outdoor stations do not establish conditions at a
  particular roof or property.
- The product may prepare a documentation checklist for an insurer discussion;
  it does not determine damage, engineering causation, coverage, deductibles,
  liability, repair scope, or a claim outcome, and it does not submit anything
  externally.

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
- Do not expose raw upstream errors or secrets to the browser.
- Treat external evidence text as untrusted content in WebMCP responses.
- Run secret and client-exposure checks before release.

## Claims

Do not claim source coverage, freshness, deployment, model behavior, accuracy,
or browser support without reproducible evidence at that exact boundary.
Local, CI, preview, production, live-source, and physical-device evidence are
separate.
