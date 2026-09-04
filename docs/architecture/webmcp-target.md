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

Eight tools are registered once whenever WebMCP is available. Five operate
without page-result context. Three are state-dependent: their definitions and
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

### look_up_place_location

Resolves a place name through the same bounded Photon/OpenStreetMap geocoder
used by analysis. It returns only source-supplied representative coordinates,
place bounds when available, administrative context, and provenance. It does
not run environmental sources or infer conditions. A unique validated result
selects and frames the place on the shared map while preserving the current
radius, map date, and requested layer visibility. Evidence is cleared only if
the selected place changes.

An ambiguous result lists every validated candidate in the bounded response,
up to five, including a human-readable name, available administrative context,
representative coordinates, and source-supplied bounds when available. The
global page notice shows those choices and asks which place
the person meant. No match, invalid input, and lookup failure also produce a
visible explanation in ordinary language. None of these unresolved outcomes
moves the map or clears evidence. Cancelled or superseded older calls produce
no notice and cannot replace newer state.

Named-place searches reserve their own last-request-wins order without
invalidating in-flight analysis while the result is still unknown. Ambiguity
and failure may therefore remain visible while compatible analysis completes.
A unique result then claims the shared context action before applying the
selection—even for a same-place refocus—so an older request cannot overwrite
the finished lookup. A dedicated place-focus counter drives camera framing and
exit from the non-map fallback; ordinary layer changes use a separate Agent map
counter and do not reframe the place.

The lookup tool resolves only after the provider has committed both the map
transaction and its visible notice. Two always-mounted announcement slots
alternate for repeated results, allowing identical success or failure text to
be announced again without showing an implementation counter.

### set_environmental_map_layers

Applies one strict desired-state patch for rain satellite, surface-heat
satellite, FIRMS thermal anomalies, and flood extent. Omitted layers remain
unchanged and repeating the same visibility patch is idempotent. Optional
place, one UTC date, and radius changes use the canonical shared selection;
multi-day ranges are never silently collapsed. The result separates requested
visibility from verified rendered visibility and labels every layer as
visualization-only with its source, limitation, and runtime status. Place/date/
radius changes clear stale analysis; a pure layer toggle preserves it.

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

That three-choice contract applies to environmental analysis. A
geography-only `look_up_place_location` request instead exposes all validated
candidates in its separately bounded set, up to five, because their geographic
details are the requested result as well as the information needed to choose.
The person-facing notice uses place names and ordinary geographic descriptions;
stable IDs remain retry metadata rather than UI instructions.

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
All eight definitions share one AbortController and one page-lifetime
registration. Abort only when the bridge unmounts or group registration fails;
ordinary analysis-state changes must not unregister or re-register tools.

The four state-dependent execute callbacks read the latest authoritative
analysis or map snapshot through stable getters. This keeps RegisteredTool
handles valid across analysis, comparison, and back-to-back map turns without
mixing state from different render generations.

## Security and failure behavior

- Analysis, place-lookup, and map-layer tools do not mutate persistent or
  external state, but their `readOnlyHint` is false because synchronizing the
  visible page is an intentional state change.
- Hazard and coverage discovery are accurately marked read-only and never
  update the shared UI or query a live source.
- External observations are marked as untrusted content.
- Cross-origin exposure is disabled unless an exact trusted origin is
  explicitly required.
- Invalid input, ambiguity, unsupported coverage, no observation, source
  failure, and internal failure return distinct compact states. Place-lookup
  ambiguity, invalid input, no match, and failure additionally produce a
  visible page notice that uses ordinary language rather than internal status
  or field names.
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
