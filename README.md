# Sky to Porch WebMCP

Sky to Porch helps ordinary people examine environmental evidence for a place
without pretending that regional observations are household-level certainty.
This repository extends the existing application with WebMCP so a person and
an AI agent can work from the same map, evidence, provenance, and limitations.

## Challenge status

The pre-existing product has been imported and its deterministic regression
baseline is being preserved. WebMCP implementation is currently in progress;
this README will not claim a tool or live experience until it has been
implemented and verified.

The original application and the exact prior-work boundary are documented in
[PRIOR_WORK.md](PRIOR_WORK.md).

## Intended human-agent experience

A person opens Sky to Porch and chooses or describes a place and environmental
concern. An agent can run the same validated analysis used by the human form,
then synchronize the visible map and evidence panel. The person can inspect
the observations, source coverage, freshness, limitations, and verification
links before deciding what the evidence means for them.

The agent does not replace the evidence pipeline. Deterministic code continues
to own:

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

## Architecture direction

Human UI and WebMCP tools will share one application layer:

    Human form -----\\
                     > Analysis service -> validated evidence -> shared UI
    WebMCP tool ----/                              |
                                                   -> compact tool result

The imported hazard adapters, source registry, evidence contracts, evaluator,
map, and failure-state UI remain the evidence-first foundation.

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
.env.example for optional server-side source configuration. Never expose
source or model credentials through NEXT_PUBLIC_*.

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
