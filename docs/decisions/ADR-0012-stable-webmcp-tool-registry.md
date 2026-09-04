# ADR-0012: Stable page-lifetime WebMCP tool registry

**Status:** Accepted
**Date:** 2026-09-03

## Context

The original bridge registered four baseline tools when the page mounted, then
registered and unregistered two contextual tools as analysis state changed.
Those contextual execute callbacks captured the result that existed when each
tool object was created.

WebMCP uses an `AbortSignal` to remove a registered tool and does not provide an
atomic replace operation in the supported interface. A browser client may hold
a `RegisteredTool` handle while an unrelated contextual registration changes
the registry. In observed Chrome testing, later executions failed before the
application callback received any input, consistent with a client using an
invalid registry snapshot after a tool change.

## Decision

Register all six WebMCP tools once per page lifetime with one registration
controller:

1. Tool names, schemas, descriptions, and registered object identities remain
   stable across analysis, comparison, and UI-state changes.
2. The inspection and claim-discussion callbacks read the latest committed
   `activeAnalysis`, related analyses, and UI callback through a stable state
   reader when execution begins.
3. Each execution takes one state snapshot so a response cannot mix analysis
   generations.
4. Inspection returns `no_active_analysis` before a result exists.
5. Claim preparation returns `no_active_analysis` before a result and
   `not_available_for_current_result` when the active result is not eligible.
   Neither response changes the UI.
6. The registration signal is aborted only when the bridge unmounts or any
   member of the initial registration group fails. Per-call cancellation keeps
   using the separate execute signal.

This supersedes only the state-scoped registration portion of ADR-0004. The
contextual tools remain bounded to valid state through fail-closed execution.

## Consequences

- Completing or replacing an analysis produces no mid-conversation registry
  mutation, so a previously discovered tool handle remains usable.
- `Agent ready` now means the complete six-tool surface registered successfully.
- The initial surface contains two actions that may not yet apply. Their
  descriptions discourage premature selection, and their deterministic
  availability results prevent unintended work.
- A contextual registration failure can no longer be hidden behind a successful
  baseline status; registration remains all-or-nothing.
- Unit and browser tests must assert registration count and handle identity
  across state transitions, not only that an abort signal changes on unmount.
- Native-browser verification remains necessary because application tests
  cannot prove a particular browser extension's registry implementation.
