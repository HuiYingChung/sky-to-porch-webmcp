# ADR-0006: Deterministic Agent input boundaries

**Status:** Accepted
**Date:** 2026-08-27

## Context

Challenge-Agent use exposed two related failures. After a geocoder returned
multiple places, the Agent could select one candidate without asking the
person. Model-backed evaluation also showed that optional coordinate and date
fields invited the model to invent coordinates or time windows even when the
person had supplied neither. A guessed coordinate could bypass place
ambiguity; an invented current date could make the resumed analysis fail
before evidence retrieval.

The earlier discovery schemas also exposed `demo_id` and `source_id` selectors.
Those selectors were deterministic once supplied, but a model could guess
them instead of using the returned catalog.

## Decision

- Remove `latitude` and `longitude` from the public analysis schema. Named
  places always use the product geocoder. If the person explicitly supplies a
  coordinate pair, the Agent copies it into `place` as `latitude, longitude`
  and deterministic code parses and validates it.
- An ambiguous result returns label-only choices plus explicit stop, ask,
  wait, and continuation instructions. It does not expose retry coordinates.
  After the person's reply, the Agent calls the same analysis tool with the
  selected label and preserves every other argument.
- Replace optional `start_date` and `end_date` with one required `time` value:
  `latest_completed`, one `YYYY-MM-DD`, or a bounded
  `YYYY-MM-DD/YYYY-MM-DD` range. Deterministic code still rejects invalid,
  future, unordered, or hazard-incompatible ranges.
- Keep `get_sky_to_porch_help_and_demos` selector-free and return compact ready
  inputs for all three curated demos. Its name and description make it a
  missing-hazard/help surface rather than a preflight for concrete analysis.
  Keep source coverage hazard-wide and selector-free.
- Evaluate the pre-choice wait and post-choice continuation separately from
  deterministic tool execution. A model score is not a substitute for the
  browser test that proves the selected label reaches the shared controller
  and updates the human UI.

## Consequences

- A model cannot bypass named-place ambiguity with guessed coordinate fields.
- The required time intent survives a multi-turn place clarification and
  cannot silently become an invented current-day range.
- Explicit coordinates remain supported without trusting a model-generated
  label as a verified place.
- Discovery responses are slightly larger because each call returns the full
  bounded catalog, but remain below the 2,400-character output limit.
- Tool selection remains model behavior. The structured stop/wait contract and
  label-only choices materially constrain it, while model-backed outcomes must
  still be reported separately and truthfully.
