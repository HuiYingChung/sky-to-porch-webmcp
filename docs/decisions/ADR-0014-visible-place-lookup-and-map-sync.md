# ADR-0014: Visible place lookup and shared-map synchronization

**Status:** Accepted
**Date:** 2026-09-04

## Context

ADR-0013 made `look_up_place_location` return geography only to the Agent. A
successful lookup therefore left the map unchanged, while an ambiguous name,
an invalid request, or a lookup failure could leave the person with no visible
explanation on the page. That behavior conflicts with the shared-page goal: a
person should be able to see what an Agent action found or why it could not
finish.

An ambiguous result is also useful geography, not merely an error. Showing the
available places and their locations helps a person distinguish namesakes
without letting the Agent guess. At the same time, a lookup that did not choose
one place must not replace the person's current map or discard evidence.

## Decision

1. A successful lookup with exactly one validated place selects that place and
   frames it on the shared desktop/mobile map. It preserves the current
   analysis radius, map date, and requested layer visibility. If no prior map
   context exists, the normal map defaults apply.
2. Evidence is cleared only when the selected place actually changes. Looking
   up the place that is already selected may refocus the map, but it preserves
   matching evidence.
3. An ambiguous lookup returns every validated candidate within the bounded
   result set, up to five. Each candidate includes a human-readable place name,
   available administrative context, representative coordinates, and
   source-supplied bounds when available. Stable choice metadata remains
   available for an exact retry.
4. The page shows those candidates in a global notice and asks, in ordinary
   language, which place the person meant. No candidate is selected
   automatically. The current map, requested layers, and evidence remain
   unchanged until the person chooses and the lookup succeeds.
5. No match, invalid input, and lookup failure also produce a visible global
   notice in ordinary language. The notice must explain what the person can do
   next without exposing internal status names, field names, or implementation
   terminology. These outcomes do not move the map or clear evidence.
6. A cancelled or superseded older call stays silent. It cannot replace a
   newer notice, move the map, or clear evidence.
7. `look_up_place_location` has `readOnlyHint: false`. It still does not write
   persistent or external data, but a unique success intentionally changes the
   visible shared-page state.
8. Starting a speculative lookup does not cancel an analysis that can still
   finish against the current place. Ambiguity and failure therefore leave that
   work alone. Every unique lookup success claims the newest context action,
   including a same-place refocus, so older work cannot later replace it.
9. Place framing uses a dedicated focus revision. A layer-only Agent update may
   reveal the mobile Map view, but it does not move the camera or force the
   non-map fallback back to the map.
10. The page keeps its assistive-technology announcement regions mounted before
    any result. Repeated identical results alternate between persistent empty
    slots so each completed lookup produces a fresh announcement without
    exposing an internal counter.

This decision partially supersedes Decision 2 of ADR-0013. It does not change
the separation between geography lookup, environmental analysis, source
coverage, and map imagery.

## Consequences

- A geography-only request produces a result that the person can inspect on
  the same map as later environmental work.
- Ambiguity becomes useful and visible: every accepted candidate in the
  bounded response is shown with enough geographic context to make a choice.
- The Agent cannot silently pick a namesake, and a failed lookup cannot destroy
  the person's current context.
- User-facing copy requires plain-language review in addition to schema and
  state tests.
- Lookup completion is not reported until the shared map or notice has reached
  the page, including an announcement-ready DOM change for repeated results.
- Tests must cover unique-result framing, preservation of radius, date, and
  layer visibility, conditional evidence clearing, all bounded ambiguity
  candidates, visible no-match/invalid/failure notices, and silent stale or
  cancelled calls.
