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

Six tools are registered once whenever WebMCP is available. Four operate
without page-result context. Two are state-dependent: their definitions and
registered handles remain stable, while execution reads the latest committed
page state and returns a deterministic availability status when its prerequisite
does not exist.

### get_sky_to_porch_help_and_demos

Returns the governed hazard IDs, optional user-concern vocabulary,
non-recursive related-context defaults, and a compact index of three curated
historical demos with ready analysis inputs. It takes no selector input. It is
read-only and intended only when a request lacks a named or implied hazard, for
capability questions, or for explicit demo selection. For missing-hazard
requests, the Agent may use this help catalog once, must ask the person to
choose, and must wait. It is not a preflight before concrete analysis.

### get_environmental_source_coverage

Reads the same checked-in source-coverage catalog shown by the human About UI.
A hazard call returns every matching source with compact region and temporal
coverage. It accepts no source selector. It makes no live request and labels
every result
`pipeline_eligibility_not_observation`, so region or time eligibility cannot be
presented as an actual observation for a selected place and date.

### analyze_environmental_hazard

Runs the complete safe analysis path and synchronizes the visible UI.

Inputs:

- place text, or an exact coordinate pair stated by the person inside `place`;
- hazard;
- required time (`latest_completed`, one completed UTC date, or a bounded date
  range copied from the person's request);
- analysis scope (`related_context` by default, or `single_hazard_only` only
  for an explicitly narrow question);
- optional everyday concern; omission resolves to neutral `general`;
- optional question.

Output:

- evidence state;
- normalized place and time;
- a small set of observations;
- evidence-strength and confidence summary;
- structured source, product, observed/retrieved time, and verification URL citations;
- freshness and required limitations;
- a stable analysis identifier.

The output excludes raw source payloads and long prose.

Its description tells the Agent to call it directly for a concrete
place-and-hazard question rather than creating a discovery-tool waterfall.

### compare_environmental_evidence

Runs two independently specified scenarios through the same shared analysis
controller. Each scenario owns its place, time, and optional radius. Generic
storm comparison expands to separate Wind & Storm and Flood & Heavy Rain
chains for both scenarios; explicit wind-only or rain/flood-only requests stay
narrow. The compact result includes every scenario and chain, deterministic
agreements and differences, direct observations, supported inference,
unknowns, failed checks, and evidence that would change the conclusion.

The shared UI commits the comparison as one Agent investigation, shows bounded
retrieval and synthesis progress, and retains a visible link to every result.
No scenario or chain can silently replace another in the Agent receipt.

### inspect_current_environmental_evidence

Reads the strongest primary and related observations, confidence, structured
citations, source status, limitations, and the hazard-specific scope from the
latest committed result. Before a completed result exists it returns
`no_active_analysis`. The Agent may focus the read on a summary, direct
observations, sources, limitations, or evidence still needed, and may select
one already completed chain. It does not run another query and is not required
before or after the primary tool.

### prepare_storm_claim_discussion

Opens a bounded claim-discussion guide only when the latest committed result is
Home + Wind & Storm and that guide exists. Before any completed result it
returns `no_active_analysis`; for other results it returns
`not_available_for_current_result` without changing the UI. When applicable it
returns a confidence-labelled assessment, supporting official observations,
property-specific questions, and a documentation checklist. It does not
contact an insurer or submit a claim.

Related context is the Agent default. Deterministic code expands the selected
primary hazard through a bounded, non-recursive relationship table: Wind with
Flood, Heat with Drought, Fire/Smoke with Air Quality, and Volcanoes with Air
Quality and Heat. The Agent may add hazards that a broad question names or
strongly implies, up to three context chains. It uses `single_hazard_only` only
when the person explicitly restricts the request to one hazard.

Every result exposes a hazard-specific `evidence_scope`. The tool resolves the
place once, runs independent domain analyses in parallel under one cancellation
and stale-generation guard, and returns one compact bundle labelled
`related_evidence_for_assessment`. The bundle counts chains with official
observations and instructs the Agent to state the strongest supported inference
and confidence while labelling direct observation separately. The shared UI commits the finished bundle
as one transaction, renders the primary evidence first, and keeps related
chains in separate sections. No companion observation repairs another chain's
no-data or source-failure state.

When no coordinates are supplied, place search returns at most three choices.
One result proceeds; multiple results return `needs_place_choice` with
card-ready labels, stable `choice_id` values, and no public coordinate bypass.
The Agent keeps the original place, hazard, concern, time, radius, and question
unchanged, asks the person, waits for the reply, then copies the selected ID to
`place_choice_id`. Deterministic code refreshes and validates that ID against
the current candidates before analysis, so duplicate labels and candidate
reordering cannot select the wrong place or restart the ambiguity loop.

After a successful Agent analysis, the visible product shows an action receipt
with the place, hazard, and time. Evidence is one action away. If another
completed result was visible before the Agent update, one previous snapshot is
retained so the person can restore the entire shared view without maintaining
an unbounded history.

Meaning leads with the strongest deterministic finding and confidence derived
from the active result. Evidence state, unique observed-source count, citations,
and concise scope notes remain available; a missing-data reminder appears only
when retrieval returns no usable observation.

## Registration lifecycle

Register the complete tool set from a client component after feature detection.
All six definitions share one AbortController and one page-lifetime
registration. Abort only when the bridge unmounts or group registration fails;
ordinary analysis-state changes must not unregister or re-register tools.

The two state-dependent execute callbacks take one snapshot of the latest
committed analysis state through a stable getter. This keeps RegisteredTool
handles valid across analysis and comparison turns without mixing state from
different render generations.

## Security and failure behavior

- The tool does not mutate persistent or external state, but its
  `readOnlyHint` is false because synchronizing the visible page is an
  intentional state change.
- Hazard and coverage discovery are accurately marked read-only and never
  update the shared UI or query a live source.
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
