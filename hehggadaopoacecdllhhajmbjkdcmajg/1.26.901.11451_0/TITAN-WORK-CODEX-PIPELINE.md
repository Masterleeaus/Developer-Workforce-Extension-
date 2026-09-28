# Titan Work → Codex Pipeline v0.1

WP3 supplies the stable contract layer between completed Chat research cycles, Work supervisors, bounded Codex builders and the final Codex orchestrator.

It deliberately does **not** own Chat scheduling, Agent Profile casting, Mission Control, GitHub Truth, Runtime Verification or acceptance state.

## Public module

`titan-work-codex-pipeline.js` exports `window.TitanWorkCodexPipeline` in the extension and `module.exports` in Node/self-test environments.

### Work supervision

`createCycleReview(input)` creates a durable `CycleReview` containing:

- mission
- worker / squad / cycle
- passes completed
- approved and rejected findings
- unresolved questions
- architecture implications
- dependencies
- evidence quality
- next decision
- provenance

Allowed Work decisions:

- `CONTINUE_5`
- `READY_FOR_CODEX`
- `REDIRECT`
- `BLOCKED`

Research reviews occur on five-pass boundaries. Normal supported epochs are 5, 10 and 15 passes. A review at 15 passes cannot return `CONTINUE_5`; it must explicitly choose another route.

`nextResearchEpoch(review)` converts the Work decision into a deterministic routing action.

## Approved Implementation Delta

`compileApprovedImplementationDelta(...)` accepts only source reviews whose decision is `READY_FOR_CODEX`.

The durable delta contains:

- validated findings
- required changes
- `scope_paths`
- expected files/symbols
- dependencies
- architecture constraints
- tests
- acceptance criteria
- runtime verification
- rejected approaches
- unresolved caveats
- provenance to CycleReviews

A delta must have a non-empty bounded scope.

## Codex implementation packet

`createCodexImplementationPacket(delta, ...)` compiles only the implementation material needed by a builder.

A packet may narrow an Approved Delta but may not expand its `scope_paths`.

`assignBuilder(delta, input, builderState)` chooses `builder-a` or `builder-b` deterministically from:

- repository compatibility
- current scope ownership
- conflicting paths
- workload

Explicit builder assignment is still validated against the known slots.

## Builder result

`createBuilderResult(...)` records:

- files changed
- actual diff
- tests
- commit
- branch
- PR
- CI
- blockers
- remaining implementation
- packet provenance

When the source packet is supplied, changed files are checked against packet scope and fail closed on expansion.

## Codex Orchestrator

`createOrchestratorBundle(...)` assembles:

- Mission Contract
- Approved Deltas
- Builder A/B results
- actual Git diff
- commits
- PRs
- CI
- tests
- architecture constraints
- runtime evidence
- acceptance evidence
- GitHub truth
- provenance

`decideOrchestrator(bundle, hints)` returns one of:

- `COMPLETE`
- `REPAIR`
- `RESEARCH`
- `VERIFY`
- `BLOCKED`

Routing:

- REPAIR → bounded packet to the appropriate builder
- RESEARCH → bounded request to the appropriate Chat squad
- VERIFY → verification plane
- BLOCKED → Mission Control attention
- COMPLETE → final objective gates

### Objective gate rule

`COMPLETE` cannot be returned unless all required objective gates pass:

- GitHub Truth: commit exists, CI passes, merged, present on main
- Runtime Verification where required
- acceptance evidence
- tests
- no remaining builder blockers/implementation

Worker prose or orchestrator prose is never treated as completion evidence.

## Existing-system adapters

`registerAdapters({...})` accepts adapters for:

- `missionControl`
- `githubTruth`
- `runtimeVerification`
- `acceptanceVerification`
- `audit`
- `repository`

`collectVerificationEvidence(bundle)` calls the registered Git/runtime/acceptance providers without duplicating their state.

Agent 4 should bind these to the canonical v3.0.34/native services during integration.

## State transition guard

`transition(current, next)` enforces the coarse WP3 lifecycle:

`research → supervisor-review → delta-approved → builder-dispatch → building → orchestrator-review → verification/repair/research/blocked/complete`

Invalid jumps fail closed.

## Provenance

`buildProvenanceChain(...)` preserves:

Mission → Chat cycles → CycleReviews → Approved Delta → Codex packet → Builder result → Orchestrator decision → verification.

The pipeline never intentionally strips earlier provenance references.

## Tests

`titan-work-codex-pipeline-selftest.js` covers:

- 5/10/15-pass decisions
- the explicit decision requirement at pass 15
- malformed/non-approved delta handoff
- builder workload selection
- conflicting scope ownership
- builder scope expansion rejection
- COMPLETE objective-gate enforcement
- REPAIR / RESEARCH / VERIFY / BLOCKED routing
- state-transition failures
- end-to-end provenance

Node invocation from the extension directory:

`node titan-work-codex-pipeline-selftest.js`

## Integration notes for Agent 4

1. Load `titan-work-codex-pipeline.js` before the integration controller that consumes WP3.
2. Convert Agent 2 `cycle complete / supervisor review required` events into `CycleReview` input.
3. Keep supervisor reasoning outside this deterministic module; pass its structured result into `createCycleReview`.
4. Keep the canonical Mission Contract in Mission Control and pass snapshots/references into WP3.
5. Bind native Work execution to the two logical Work supervisor slots.
6. Bind native Codex execution to `builder-a`, `builder-b` and the final orchestrator.
7. Feed actual Git diff/CI/GitHub evidence into the orchestrator bundle rather than trusting builder summaries.
8. Run Runtime Verification and acceptance through registered adapters.
9. Preserve Agent 4 scope-lock/approval systems around any requested scope expansion.
10. Merge this package as a stable isolated dependency; no modification of the legacy 5×5 supervisor is required by WP3 itself.
