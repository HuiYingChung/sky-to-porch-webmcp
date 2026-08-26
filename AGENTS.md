# Sky to Porch WebMCP — Agent Operating Rules

## Purpose

This repository is the WebMCP extension of the pre-existing Sky to Porch
environmental-evidence application. The user owns product direction and makes
human-workflow decisions. Codex owns implementation, integration, and
verification unless the user explicitly changes that assignment.

PLAN.md is the current delivery plan. PRIOR_WORK.md defines the boundary
between the imported product and work created for the WebMCP Challenge.

## Authority

Use this order when instructions differ:

1. the user's latest explicit instruction;
2. this file;
3. PLAN.md;
4. current decisions under docs/decisions/;
5. current governance under docs/governance/;
6. other repository documentation.

Stop and ask when a conflict would materially change product behavior,
publication scope, safety boundaries, or user intent.

## Working rules

- Preserve unrelated user work and inspect Git state before writing.
- Keep commits scoped and truthful.
- Do not rewrite published history, force-push, deploy, change visibility, or
  submit without explicit authorization for the exact action.
- Do not use provider secrets or perform paid/live requests unless the current
  task requires them and the user has authorized that boundary.
- Treat local, CI, preview, production, live-source, and physical-device
  evidence as separate claims.
- Run targeted checks while implementing and the full applicable gate before a
  milestone is called complete.

## Product and safety boundary

Deterministic code owns location and time validation, source coverage,
retrieval, schema checks, calculations, freshness, provenance, limitations,
confidence, and whether evidence is safe to present.

AI agents may choose registered WebMCP tools and explain validated evidence.
They must not invent observations, hide source failures, imply that missing
data means no danger, issue emergency decisions, or predict earthquakes or
eruption timing.

Sky to Porch is public-information software, not an alerting or emergency
decision system. Preserve the distinction between:

- valid observation;
- no observation returned;
- source failure;
- unsupported coverage;
- stale data;
- inconclusive evidence;
- no active official alert.

## WebMCP implementation rules

- Human UI and WebMCP tools must use the same analysis service and result
  contract.
- Tool schemas, descriptions, errors, and outputs must be deterministic and
  tested independently of model behavior.
- Keep tool output compact and preserve provenance, limitations, and
  verification links.
- Mark external-source content as untrusted and read-only tools accurately.
- Feature-detect WebMCP and preserve a functional non-WebMCP browser path.
- Do not make an internal model provider a prerequisite for WebMCP evidence.

## Product decisions

Codex should make routine technical decisions and continue working. Ask the
user for a product ruling when a choice materially changes:

- what the human sees before, during, or after an agent action;
- whether an agent action updates the shared map or evidence panel;
- how ambiguity, no-data, and failure states are presented;
- the intended demo journey or public claims.

Present those choices in plain language; the user is not expected to know MCP
APIs.

## Attribution and prior work

Do not claim imported Sky to Porch functionality as new WebMCP work. Keep
PRIOR_WORK.md accurate, retain a link to the original repository and
baseline commit, and disclose material tool assistance truthfully without
making prior development tools the product's current identity.
