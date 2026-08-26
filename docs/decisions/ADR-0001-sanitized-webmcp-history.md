# ADR-0001: Use a sanitized WebMCP repository history

**Status:** Accepted
**Date:** 2026-08-26

## Context

The original Sky to Porch repository contains hundreds of commits and extensive
internal development records from a prior competition. The WebMCP Challenge
requires a public, reproducible repository and a clear distinction between
prior work and challenge work.

Publishing the full imported history would expose unnecessary internal records
and obscure the WebMCP extension. Deleting files only from the current tree
would not remove them from reachable history.

## Decision

Create a new root commit containing an intentionally selected product baseline,
tests, necessary scripts, and current public documentation. Record the original
repository, source commit, imported head, imported tree, exclusions, and
development assistance in PRIOR_WORK.md.

Preserve the complete imported history in:

- the original sky-to-porch repository; and
- local ref archive/pre-webmcp-import-a8fa5b8.

Subsequent commits in this repository represent WebMCP challenge preparation
or implementation and must remain scoped and truthful.

## Consequences

- The public repository has a concise and reviewable history.
- Original authorship and process evidence remain available through the
  disclosed source repository.
- The sanitized root commit is explicitly an import, not a claim of new work.
- Any future public release still requires current-tree, reachable-history,
  rights, claims, reproducibility, and exact-candidate review.
