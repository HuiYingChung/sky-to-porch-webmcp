# Native WebMCP Agent acceptance — 2026-08-27

## Evidence boundary

This record keeps the deployed production result, the corrected local
candidate, deterministic regression coverage, and remote CI as separate
claims.

- Production alias: `https://sky-to-porch-webmcp.vercel.app/`
- Deployed Git head: `6ca5698c8c123b873e4dc9c767c037acce72445d`
- Corrected local branch: `codex/webmcp-agent-acceptance`
- Corrected implementation commit: `5972b4f`
- Supported native surface used: the ChatGPT/Codex in-app browser WebMCP
  capability, without a `document.modelContext` test double
- No push, pull request, deployment, alias change, provider credential, paid
  request, repository-visibility change, or submission occurred

The browser calls below were directed to named tools with recorded arguments.
They prove native discovery and execution, but they are not a repeated,
model-scored tool-selection evaluation. The checked-in selection dataset
therefore remains pending.

## Current official guidance rechecked

The verification used the challenge's currently documented default supported
environment and did not rely on the older local Chrome result:

- [WebMCP Challenge rules](https://webmcp.devpost.com/rules) identify the
  ChatGPT desktop in-app browser as the default environment and Chrome 149+
  with the WebMCP testing flag as the alternative.
- [Chrome WebMCP guidance](https://developer.chrome.com/docs/ai/webmcp)
  requires a secure origin and describes native browser tool registration.
- [Chrome WebMCP evaluation guidance](https://developer.chrome.com/docs/ai/webmcp/evals)
  separates tool selection, arguments, ordering, and full journeys from
  deterministic tests.
- The [current WebMCP draft](https://github.com/webmachinelearning/webmcp/blob/main/index.bs)
  permits the browser execution surface exercised here. The installed
  `webmcp-types@0.1.5` package still describes the callback options object as
  required, so runtime feature compatibility must not assume it is supplied.

Installed Chrome 151 loaded the production alias through the available Chrome
control surface, but that surface did not expose a WebMCP capability. Access to
`chrome://version` and `chrome://flags` was blocked by the browser-control URL
safety boundary. This was not bypassed and is not reported as either a native
Chrome pass or evidence that Chrome itself lacks WebMCP.

## Production alias result at `6ca5698`

The public alias loaded successfully in both controlled Chrome and the
supported in-app browser. The in-app browser natively discovered exactly these
three baseline tools:

1. `analyze_environmental_hazard`;
2. `list_environmental_hazards`;
3. `get_environmental_source_coverage`.

Native execution of both read-only discovery tools succeeded. The hazard
catalog returned seven governed hazards, the concern vocabulary, related
context defaults, and `co_occurring_context_not_causation`. Wind coverage
returned three eligible sources, stated
`pipeline_eligibility_not_observation`, and made no live-source claim.

The production primary-tool attempt used:

```json
{
  "place": "Houston, Texas, United States",
  "hazard": "wind_storm",
  "analysis_scope": "related_context",
  "concern": "home",
  "radius_km": 25,
  "start_date": "2024-07-08",
  "end_date": "2024-07-08",
  "question": "Could Hurricane Beryl have damaged my home or roof, and what official environmental evidence can help me discuss it with my insurer?"
}
```

That native call failed before analysis with:

```text
Cannot read properties of undefined (reading 'aborted')
```

The production UI did not update. A successful deployment state therefore did
not establish primary-tool execution. Inspection localized the failure to the
tool callback reading `options.signal` even when the native client supplied
only the schema input.

## Compatibility correction

Commit `5972b4f` preserves a client-provided cancellation signal and creates a
never-aborted per-call signal only when callback options are omitted. The
analysis service, source selection, result contract, UI transaction, and
safety semantics are unchanged.

The regression test invokes the registered tool with one argument, verifies
that the shared analysis service receives an `AbortSignal`, and verifies that
a deterministic `source_failure` remains `source_failure` with null evidence,
the provider limitation, and `no_data_is_not_no_danger: true`.

## Corrected local native journey

The corrected candidate ran through the supported in-app browser's native
WebMCP surface against an isolated local dev server. No test double was
injected. The broad Beryl request added explicit Houston coordinates:

```json
{
  "place": "Houston, Texas, United States",
  "hazard": "wind_storm",
  "analysis_scope": "related_context",
  "concern": "home",
  "latitude": 29.7604,
  "longitude": -95.3698,
  "radius_km": 25,
  "start_date": "2024-07-08",
  "end_date": "2024-07-08",
  "question": "Could Hurricane Beryl have damaged my home or roof, and what official environmental evidence can help me discuss it with my insurer?"
}
```

The native tool returned `related_environmental_evidence_bundle` and
`ui_updated: true`. It retained independent successful chains:

- Wind & Storm:
  `wind_only_no_rain_flood_or_water_gages`;
- Flood & Heavy Rain:
  `water_only_no_wind_damage_causation`.

The bundle declared `co_occurring_context_not_causation`,
`claim_discussion_available: true`, and
`related_evidence_visible_in_shared_view: true`. The visible app synchronized
the Houston selection, 25 km map area, complete 2024-07-08 UTC day, Home
concern, question, Agent receipt, primary Wind evidence, and separately
labelled Flood & Heavy Rain context.

After the shared result committed, native discovery added
`inspect_current_environmental_evidence` and
`prepare_storm_claim_discussion`. Inspection reported a peak gust of 39.6 m/s
at `2024-07-08T14:35:00.000Z`, with GHCNh and the NWS Tropical Cyclone Report
as Wind sources, while preserving the related Flood chain separately. The
claim-discussion tool returned `ready_for_discussion`, opened the visible
bounded checklist, and retained `no_claim_decision: true` with property damage,
causation, coverage, liability, and outcome unresolved.

These observations were returned by bounded application routes during this
explicit acceptance journey. They are not a separately authorized live-source
smoke suite and do not establish future source availability or property-level
damage.

## Narrow and failure-boundary journeys

An explicitly narrow travel question requested only the maximum Wind gust and
used `analysis_scope: single_hazard_only`. It returned one Wind result with the
same 39.6 m/s peak and updated the shared UI. No related-context section was
shown, and `prepare_storm_claim_discussion` was not registered; only current
evidence inspection became contextual.

The native ambiguity request for Springfield returned
`needs_place_choice`, `ui_updated: false`, and three card-ready choices for
Massachusetts, Illinois, and Missouri. It did not guess a location.

The native Earth & Volcanoes request for a 1 km Tucson area on 2024-07-08
returned `no_observation`, an empty observation list, insufficient confidence,
`ui_updated: true`, and the explicit no-data safety boundary. It did not turn
missing evidence into reassurance.

A native provider failure was not forced. Source-failure preservation is
covered only by the deterministic one-argument callback regression described
above. Cancellation, unsupported coverage, and stale-result behavior remain
application-owned deterministic coverage, not new native-Agent claims in this
record.

## Local exact-candidate gate

The full gate ran with the production Playwright server isolated on
`localhost:3117` after the compatibility change:

```text
npm run verify
```

- TypeScript typecheck: passed.
- ESLint: passed with no warnings or errors.
- Unit suite: 70 files, 1,278 tests passed.
- Integration suite: 10 files, 132 tests passed.
- Production build: passed; 14 of 14 pages generated.
- Playwright: 224 desktop/mobile journeys passed.
- Secret check: passed; no potential secrets found.

Playwright still uses its deterministic `document.modelContext` test double;
its result is retained separately from the native in-app-browser evidence.

## Remote and release status

- PR #1 CI at run `33031632267` passed for the merged baseline.
- Post-merge `main` CI at run `33032411912` passed for `6ca5698`.
- The Vercel deployment associated with `6ca5698` is Ready and the public alias
  loads, but native production primary-tool execution fails as recorded above.
- No remote CI, preview, deployment, or production-native result exists yet for
  corrected commit `5972b4f`.
- Repeated model-backed selection scoring, supported Chrome native execution,
  physical-device checks, and human-usability/demo review remain unproven.

Deploying or otherwise publishing the correction requires fresh explicit
authorization. After publication, the exact production Beryl, narrow,
ambiguity, no-data, and contextual-tool checks must be rerun against the public
alias rather than inferred from this local pass.
