# Devpost draft — Sky to Porch WebMCP

> Private preparation draft. Do not submit until the owner separately approves
> repository visibility, deployment of the final candidate, video publication,
> and Devpost submission. Replace every bracketed item with final evidence.

## Project links

- Live application: https://sky-to-porch-webmcp.vercel.app/
- Source repository: https://github.com/HuiYingChung/sky-to-porch-webmcp
  **(currently private; not submission-ready)**
- Demo video: `[PUBLIC YOUTUBE URL — PENDING]`
- Open-source license: Apache-2.0

## Tagline

Investigate official environmental evidence with an AI agent on the same map,
without letting the agent invent observations or blur unlike hazards together.

## Inspiration

Official environmental data is available, but it is scattered across source
systems and difficult to translate into a careful answer to a personal
question. Someone asking whether a storm could be relevant to a new roof leak
needs more than a generic summary: they need the strongest observed values,
when and where those values were recorded, links to the official sources, the
limits of the inference, and a clear account of what would require
property-specific evidence.

Sky to Porch already turned official observations into a human-readable map and
evidence panel. The WebMCP extension makes the browser page itself a governed
collaboration surface for a person and an external agent.

## What it does

A person can ask a concrete place, date, hazard, radius, and concern question.
The Agent selects a narrow WebMCP tool, runs the same deterministic analysis
controller used by the human form, and updates the visible map, Meaning panel,
Evidence panel, and Agent action receipt.

For the Hurricane Beryl demonstration, one broad roof question gathers two
separate evidence chains:

- Wind & Storm observations, including a 39.6 m/s peak gust near Houston on
  July 8, 2024;
- Flood & Heavy Rain context, kept separate from wind so water evidence is not
  presented as proof of roof-wind damage.

The result leads with a confidence-labelled assessment, then observed values,
times, official citations, limitations, and the property evidence that could
change the assessment. A contextual discussion tool appears only after a
completed Home + Wind result and opens a bounded checklist; it never makes a
claim, coverage, liability, or causation decision.

The same product path supports seven hazard families. Ambiguous places return
explicit choices instead of being guessed. No observation, source failure,
unsupported coverage, stale data, and inconclusive evidence remain distinct
program states. No observation never becomes “no danger.”

## Why WebMCP is the right fit

This is not an API wrapper beside the product. WebMCP lets the Agent operate in
the page the person is already inspecting. The Agent and human workflow share
one controller, evidence contract, map state, and evidence panels, so each can
see and continue from the other's work.

The page initially registers three baseline tools: analysis, capability
discovery, and source-coverage discovery. After a valid result exists, it
dynamically registers an inspection tool. The storm discussion tool is even
more contextual: it exists only for a completed Home + Wind result. Inapplicable
actions therefore do not clutter the Agent's tool set.

## How we built it

Sky to Porch uses Next.js, React, TypeScript, and MapLibre. Official-source
adapters feed a deterministic analysis service responsible for place and time
validation, coverage, retrieval, schema validation, calculations, freshness,
provenance, limitations, confidence, and safe display. WebMCP tool callbacks
call that same service and return compact structured results with citations.

The registration bridge is here:

https://github.com/HuiYingChung/sky-to-porch-webmcp/blob/main/src/components/webmcp/webmcp-bridge.tsx

A representative registration excerpt is:

```tsx
const baselineTools = [
  createAnalyzeHazardTool({ runAnalysis, runAnalysisBundle }),
  createListEnvironmentalHazardsTool(),
  createGetEnvironmentalSourceCoverageTool(),
];

await Promise.all(
  baselineTools.map((tool) =>
    document.modelContext!.registerTool(tool, { signal: controller.signal })
  )
);
```

Tool schemas, argument validation, failure semantics, output limits,
registration lifecycle, and shared-view updates are tested independently of
model behavior. The application does not need an internal model key to retrieve
or validate evidence.

## How WebMCP improves the experience

Without WebMCP, the person must translate a natural concern into form fields,
manually inspect several panels, and decide which related hazard to query next.
With WebMCP, the Agent can map the question to validated inputs, run the shared
analysis, keep related evidence chains separate, and explain the visible result
with the person. The UI stays inspectable and reversible instead of becoming a
hidden agent-only transaction.

## Verification

- Production native WebMCP discovery and the complete Beryl, narrow-wind,
  no-observation, inspection, and discussion journeys were exercised in the
  supported in-app browser at deployed commit `c6f3c8c`. Contextual inspection
  is now within its 2,400-character output cap.
- The published commit passed its exact GitHub Actions run.
- The production rerun exposed a 2,524-character primary evidence bundle above
  its 2,400-character contract. The current private worktree has a
  production-shaped bounded-output regression plus a stronger ambiguous-place
  STOP/wait contract. Its local gate passes 1,292 unit tests, 132 integration
  tests, a production build, 228 desktop/mobile browser journeys, and secret
  check; publication and exact production re-verification remain pending.
- The published commit passed 1,289 unit tests, 132 integration tests, a
  production build, 228 desktop/mobile browser journeys, secret checking, and
  the clean-commit mechanical reachable-history preflight. The preflight remains
  one release control rather than proof of licensing, public availability, or
  model-selection quality.
- Repeated independent model-scored selection runs remain pending and must not
  be described as passed without retained raw outcomes.

## Prior work and attribution

Sky to Porch existed before the WebMCP Challenge. The map, human query
experience, existing environmental adapters, evidence contracts, deterministic
evaluation, and most product tests are prior work. The challenge contribution
is the shared analysis application layer, WebMCP tools and dynamic registration,
human-Agent UI synchronization, related-context orchestration, Wind & Storm
evidence path, contextual discussion workflow, and WebMCP-specific verification.

The exact imported boundary, original repository, baseline commit, and material
tool assistance are disclosed in `PRIOR_WORK.md`. Repository code is
Apache-2.0; external observations remain subject to their publishers' terms and
attribution requirements.

## Current submission blockers

1. Owner approval to make the repository public.
2. Publish and production-reverify committed primary-output cap and
   ambiguous-place Agent-wait corrections.
3. Record and publish the narrated video under three minutes.
4. Replace the video placeholder and recheck exact-candidate evidence after any
   separately authorized publication change.
5. Configure an explicitly free-tier model backend, then run and retain
   model-backed selection scoring, including the post-ambiguity wait behavior;
   otherwise disclose it as unproven rather than implying a pass.
