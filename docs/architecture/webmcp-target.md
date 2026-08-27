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
- analysis scope (`related_context` by default, or `single_hazard_only` only
  for an explicitly narrow question);
- optional additional related hazards named or implied by a broad question;
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

### inspect_current_environmental_evidence

Registered only while a completed result is active. It reads the compact
primary evidence, source identifiers, limitations, the hazard-specific scope,
and any separately retained related-chain statuses. It does not run another
query and is not required before or after the primary tool.

### prepare_storm_claim_discussion

Registered only while the current result is Home + Wind & Storm and a bounded
claim-discussion guide exists. It opens that guide in the visible page and
returns a compact documentation checklist. It does not contact an insurer,
submit a claim, or decide damage, causation, coverage, liability, repair scope,
or outcome.

Related context is the Agent default. Deterministic code expands the selected
primary hazard through a bounded, non-recursive relationship table: Wind with
Flood, Heat with Drought, Fire/Smoke with Air Quality, and Volcanoes with Air
Quality and Heat. The Agent may add hazards that a broad question names or
strongly implies, up to three context chains. It uses `single_hazard_only` only
when the person explicitly restricts the request to one hazard.

Every result exposes a hazard-specific `evidence_scope`. The tool resolves the
place once, runs independent domain analyses in parallel under one cancellation
and stale-generation guard, and returns one compact bundle labelled
`co_occurring_context_not_causation`. The shared UI commits the finished bundle
as one transaction, renders the primary evidence first, and keeps related
chains in separate sections. No companion observation repairs another chain's
no-data or source-failure state.

When no coordinates are supplied, place search returns at most three choices.
One result proceeds; multiple results return `needs_place_choice` with
card-ready labels and exact retry coordinates. The agent keeps the hazard,
concern, dates, radius, and question unchanged and asks the person before
calling again.

After a successful Agent analysis, the visible product shows an action receipt
with the place, hazard, and time. Evidence is one action away. If another
completed result was visible before the Agent update, one previous snapshot is
retained so the person can restore the entire shared view without maintaining
an unbounded history.

Meaning begins with a deterministic trust strip derived from the active result:
evidence state, unique observed-source count, limitation count, and a no-danger
reminder for missing, incomplete, quiet, stale, or failed evidence.

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
- A shared storm name must not merge wind observations into a water result or
  water observations into a wind result.

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
