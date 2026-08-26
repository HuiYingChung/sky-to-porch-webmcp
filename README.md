# Sky to Porch WebMCP

Sky to Porch helps ordinary people examine environmental evidence for a place
without pretending that regional observations are household-level certainty.
This repository extends the existing application with WebMCP so a person and
an AI agent can work from the same map, evidence, provenance, and limitations.

## Challenge status

The pre-existing product has been imported behind a documented prior-work
boundary. A browser-native WebMCP vertical slice is now implemented and
verified locally with deterministic unit, integration, and browser tests.

The current tool is `analyze_environmental_hazard`. It resolves a place or
accepts selected coordinates, runs the same hazard-analysis application layer
as the human form, updates the map and Insight panel, and returns a compact
evidence result. Supported-browser discovery with the challenge agent and
model-backed tool-selection evals remain release gates; this repository does
not yet claim a public live WebMCP experience.

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
