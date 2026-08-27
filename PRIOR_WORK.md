# Prior Work and Challenge Boundary

## Original project

Sky to Porch was created before the OpenAI WebMCP Challenge.

- Original repository: https://github.com/HuiYingChung/sky-to-porch
- Last pre-submission-period product baseline:
  cd8b8b35da82ab3f58091852163da252ff7b3d3e
- Baseline commit time: 2026-08-24 18:47:03 -05:00
- Original imported repository head:
  a8fa5b8b1f27b37d86e30f0fc3d0ed33e6f341dd
- Original imported tree:
  c1c926ee05711626bdb43eeffc70f7778f92a8ff

The four commits after the baseline and before this repository was prepared
changed the original README and demo description. They did not implement
WebMCP and are treated here as prior-project documentation, not challenge work.

## Imported prior work

The sanitized baseline imports the existing application's product source,
assets, deterministic tests, and necessary build or live-source scripts. This
includes:

- the map and guided human query experience;
- hazard adapters for fire, flood, heat, drought, air quality, earthquakes,
  and volcanoes;
- place, time, evidence, provenance, limitation, and source-coverage contracts;
- deterministic evaluation and safe-display rules;
- the existing Vercel Web Analytics dependency and root-layout pageview component;
- fixture, integration, and browser tests.

None of those capabilities is claimed as new WebMCP Challenge work.

## Work excluded from the public baseline

The original private-development record contains extensive challenge-specific
prompts, session logs, handoffs, internal evidence records, and process
governance. Those files are not required to build or evaluate this product and
are intentionally excluded from the sanitized WebMCP repository.

The complete original history remains available in the original repository and
in a protected local archive ref created before the sanitized history was
built. Exclusion from this repository is public-release packaging, not a claim
that the historical work did not occur.

## Development assistance

The original application was owner-directed and included material assistance
from IBM Bob, Claude Code, OpenAI Codex, and ChatGPT at different stages.
HuiYing Chung made the product decisions and owns this submission.

For this WebMCP extension, Codex is responsible for implementation,
integration, and verification. Product workflow decisions remain with HuiYing
Chung. Commit history and repository documentation will distinguish imported
work from the WebMCP extension.

## Challenge work

Challenge work begins after the sanitized baseline import. It includes the
shared analysis application layer, WebMCP tool registration and schemas,
human-agent UI synchronization, WebMCP-specific tests and evals, provider
cleanup required by that architecture, and the final submission experience.
