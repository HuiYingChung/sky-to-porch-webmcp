# Sky to Porch WebMCP

Sky to Porch helps ordinary people examine environmental evidence for a place
without pretending that regional observations are household-level certainty.
This repository extends the existing application with WebMCP so a person and
an AI agent can work from the same map, evidence, provenance, and limitations.

## Challenge status

The pre-existing product has been imported behind a documented prior-work
boundary. A browser-native WebMCP vertical slice is now implemented and
verified locally with deterministic unit, integration, and browser tests.

The primary tool is `analyze_environmental_hazard`. It resolves a place or
accepts selected coordinates, runs the same hazard-analysis application layer
as the human form, updates the map and Insight panel, and returns a compact
evidence result. Two baseline read-only tools list the governed hazards and the
checked-in source-coverage catalog; they are for capability questions, not
mandatory preflight calls before a concrete analysis. After a result exists, a
read-only evidence-inspection tool is available; a Home + Wind result also
makes a local storm-claim discussion tool available. Supported-browser
discovery with the challenge agent and model-backed tool-selection evals remain
release gates; this repository does not yet claim a public live WebMCP
experience. Exact local verification records include
[the related-context analysis](docs/testing/wind-storm-verification-2026-08-26.md)
and [the bounded discovery tools](docs/testing/discovery-tools-verification-2026-08-26.md).

The original application and the exact prior-work boundary are documented in
[PRIOR_WORK.md](PRIOR_WORK.md).

## Intended human-agent experience

A person opens Sky to Porch and chooses or describes a place and environmental
concern. An agent can run the same validated analysis used by the human form,
then synchronize the visible map and evidence panel. The person can inspect
the observations, source coverage, freshness, limitations, and verification
links before deciding what the evidence means for them.

The agent does not replace the evidence pipeline. Deterministic code
continues to own:

- location and time validation;
- source coverage and request construction;
- upstream response and schema validation;
- calculations and freshness;
- provenance and required limitations;
- the decision that evidence is safe to present.

## Safety boundary

Sky to Porch is a public-information experience, not an emergency alerting or
professional decision system.

- No data does not mean no danger.
- Source failure, unsupported coverage, stale data, inconclusive evidence, and
  a valid observation with no anomaly are different states.
- Regional evidence is not property-level certainty.
- The application does not issue evacuation guidance.
- Earthquake and eruption timing are not predicted.
- Official alerts and local authorities remain authoritative.

## Flood evidence coverage

Live Flood analysis combines NASA GIBS precipitation visualization, NASA
VIIRS flood-extent visualization, and available ground-station evidence. USGS
gage observations cover supported U.S. selections. For a selected area within
the coarse Canadian request envelope, the application also makes one bounded,
credential-free request to the ECCC GeoMet `hydrometric-daily-mean`
collection and accepts only a station coordinate inside that exact selection.

The Canadian value is a station daily mean in metres, not a universal flood
threshold. Missing or failed GeoMet evidence remains visible and never becomes
a claim of no flooding, safe travel, or no property impact. Other GeoMet
weather and AQHI collections are not part of this integration.

## Related environmental context, without merged causation

`Wind & Storm` uses selected-area NOAA GHCNh wind speed and gust observations.
For Hurricane Beryl on 2024-07-08, a pinned NWS Houston/Galveston report may
also contribute regional post-event wind context when the selected geometry is
inside its governed Southeast Texas scope. These records do not establish wind
at a roof, property damage, causation, policy coverage, or a claim outcome.

`Flood & Heavy Rain` is the existing `flood_storm` path. It uses rainfall,
flood extent, inundation, and water-gage evidence; it does not establish wind
damage. Every WebMCP result includes a machine-readable evidence scope. A broad
storm-impact question uses `wind_storm` with the default `related_context`
scope, so the tool automatically runs both analyses and returns two related but
unmerged evidence chains.

The same product-owned relationship table covers Extreme Heat with Drought &
Land, Fire & Smoke with Air Quality, and Earth & Volcanoes with both Air
Quality and Extreme Heat. Related context is the Agent default. Only a question
that explicitly limits itself to one hazard uses `single_hazard_only`. Each
chain preserves its own source coverage, observation time, evidence state,
freshness, confidence, provenance, and limitations. The bundle label
`co_occurring_context_not_causation` prevents the Agent from presenting a
co-occurrence as proof that one hazard caused another.

The Houston Beryl roof-and-insurer journey is one practical Home use case, not
the definition of the site. Sky to Porch also supports Travel, Pets, Health,
Power & Internet, and Community questions within each source's truthful
coverage.

## Architecture

Human UI and WebMCP tools share one application layer:

    Human form -----\\
                     > Analysis service -> validated evidence -> shared UI
    WebMCP tool ----/                              |
                                                   -> compact tool result

The imported hazard adapters, source registry, evidence contracts, evaluator,
map, and failure-state UI remain the evidence-first foundation.

The application does not call an internal language-model provider. Its
plain-language Meaning panel is deterministic; the browser agent reasons over
the compact validated WebMCP result. This avoids an Agent → website model
round trip and makes evidence retrieval independent of model keys, cost, and
rate limits.

## WebMCP behavior

- Feature-detects `document.modelContext` and registers from a client
  component.
- Registers `analyze_environmental_hazard`, `list_environmental_hazards`, and
  `get_environmental_source_coverage` as the baseline surface. Concrete
  environmental questions go directly to analysis; discovery is reserved for
  capability or source-eligibility questions.
- Reads coverage from the same deterministic catalog as the human About UI,
  performs no live request, and labels it pipeline eligibility rather than an
  observation for a place or date.
- Uses an `AbortController` for registration lifecycle and forwards tool-call
  cancellation through geocoding and evidence retrieval.
- Rejects unknown fields, invalid coordinates, invalid or incomplete dates,
  and out-of-range radii.
- Returns up to three card-ready place choices when a name is ambiguous. Each
  choice has a human-readable label and exact retry coordinates; the Agent
  keeps every other input unchanged and never silently chooses one.
- Shows an Agent action receipt after a shared-view update, keeps Evidence one
  click away, and offers a one-step restore when another result was visible.
- Opens Meaning with a compact evidence-state, source-count, and limitation-count
  trust strip; incomplete or quiet evidence repeats that it does not mean no
  danger.
- Marks source-derived output as untrusted content and does not claim the tool
  is read-only because it intentionally changes the visible page state.
- Defaults Agent requests to `related_context`, using a bounded product-owned
  relationship table. `single_hazard_only` is reserved for an explicitly
  narrow question. One tool execution can therefore gather two or three
  separately labelled chains without asking the person to know the hazard or
  source taxonomy.
- Labels every bundle `co_occurring_context_not_causation`. Wind and water,
  heat and drought, smoke and ambient air quality, and volcano, air, and heat
  never substitute for one another or silently become a causal conclusion.
- Registers `inspect_current_environmental_evidence` only while a completed
  analysis is active. It reads the bounded primary result and related-chain
  statuses without starting another hazard query.
- Registers `prepare_storm_claim_discussion` only after a Home + Wind result.
  It opens a documentation checklist in the current page and never submits a
  claim or decides causation, coverage, liability, repair scope, or outcome.
- Keeps the compact tool result within the current approximately 1.5K-character
  guidance while leaving complete evidence in the UI.

See [the target architecture](docs/architecture/webmcp-target.md) and
[the evaluation boundary](docs/testing/webmcp-evals.md). The dated
[architecture audit](docs/architecture/audit-2026-08-26.md) records the
findings, completed refactors, and remaining release gates.

## Local development

Requirements:

- Node.js 22
- npm

Install and run:

    npm ci
    npm run dev

The application is available at http://localhost:3000.

Core verification:

    npm run typecheck
    npm run lint
    npm test
    npm run test:integration
    npm run build
    npm run test:e2e
    npm run secret-check

Live-source smoke scripts are intentionally separate from deterministic tests
and may require source-specific credentials or network authorization.

## Environment variables

Most deterministic development and fixture tests need no credentials. See
.env.example for optional server-side source configuration. The application
has no internal model credential. Never expose source credentials through
NEXT_PUBLIC_*.

## Prior work and attribution

Sky to Porch existed before the WebMCP Challenge. This repository does not
claim the imported product as new challenge work. The original history,
baseline commit, excluded internal records, and material development-tool
assistance are disclosed in [PRIOR_WORK.md](PRIOR_WORK.md).

## License

Code in this repository is licensed under the Apache License 2.0. External
observations and datasets remain subject to their publishers' terms and are not
relicensed by this repository. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This software is provided without warranty and does not replace official
alerts, emergency guidance, or professional advice.
