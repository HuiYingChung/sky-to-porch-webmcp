# WebMCP Target Architecture

## Objective

Expose a small, reliable set of browser tools without creating a second
environmental-analysis implementation.

## Shared path

Both the human form and WebMCP call a shared analysis controller. The
controller owns cancellation and stale-response protection, delegates to a
server-backed analysis service, and commits one unified result to the shared
map and evidence panel.

The service owns:

1. place or selected-area normalization;
2. hazard and time validation;
3. source coverage;
4. adapter execution;
5. deterministic evaluation;
6. compact result shaping.

## Implemented tool surface

### analyze_environmental_hazard

Runs the complete safe analysis path and synchronizes the visible UI.

Inputs:

- place text or selected-area coordinates;
- hazard;
- time window;
- everyday concern;
- optional question.

Output:

- evidence state;
- normalized place and time;
- a small set of observations;
- source identifiers and verification links;
- freshness and required limitations;
- a stable analysis identifier.

The output excludes raw source payloads and long prose.

### Optional second tool

A source-coverage or current-analysis tool will be added only if evals show it
improves tool selection or the shared user journey. It must not introduce a
fragile required call order.

When no coordinates are supplied, place search returns at most three
candidates. One result proceeds; multiple results return
`needs_place_choice` and require the agent to ask the person before calling
again with the chosen coordinates.

## Registration lifecycle

Register tools from a client component after feature detection. Tie
registration to an AbortController so unmounting or replacement unregisters
the tools. Keep definitions stable and use the shared controller's current
state through safe closures.

## Security and failure behavior

- The tool does not mutate persistent or external state, but its
  `readOnlyHint` is false because synchronizing the visible page is an
  intentional state change.
- External observations are marked as untrusted content.
- Cross-origin exposure is disabled unless an exact trusted origin is
  explicitly required.
- Invalid input, ambiguity, unsupported coverage, no observation, source
  failure, and internal failure return distinct compact error states.
- Tool output must not turn missing evidence into reassurance.

## Internal-model decision

The application has no internal model-provider route. Evidence retrieval and
the Human UI therefore do not depend on model credentials, paid-call budgets,
or a nested model round trip. The external browser agent may explain the
compact result; deterministic code remains authoritative for evidence and
safety states.

## Verification

Test schema validation, direct tool execution, UI synchronization,
cancellation, stale results, output budgets, and each failure state
deterministically. Separately evaluate agent tool selection, argument quality,
and complete human-agent journeys.
