# Titan Work → Codex → Orchestrator Runtime

Issue #16 turns the existing WP3 contracts into executable v4 runtime behavior.

## Boundary

The five-pass Chat scheduler still owns research cadence. A Work supervisor is invoked only after the scheduler emits `supervisor_review_required` for exactly five completed Chat passes.

`TitanLiveChatRuntime` forwards that boundary to `TitanWorkCodexRuntime`.

## Executable chain

1. **Work Supervisor**
   - receives the WP3 SupervisorReviewRequest
   - must return structured JSON with `next_decision`
   - allowed decisions: `CONTINUE_5`, `READY_FOR_CODEX`, `REDIRECT`, `BLOCKED`

2. **Approved Delta**
   - `READY_FOR_CODEX` is rejected unless the Work response includes a structured `approved_delta`
   - `approved_delta.scope_paths` must be non-empty
   - WP3 validates the delta and prevents scope expansion

3. **Builder**
   - WP3 deterministically assigns `builder-a` or `builder-b`
   - runtime maps these to v4 `BUILDER_A` / `BUILDER_B`
   - both `codex.build` and `codex.orchestrate` capabilities must be registered before implementation begins
   - review-only Codex adapters are not treated as orchestrators
   - builder output is normalized through WP3 `BuilderResult` and scope checked

4. **Evidence**
   - authoritative GitHub verification is required after the builder result
   - runtime verification is collected when the mission requires it
   - acceptance state comes from canonical Mission Control criteria
   - test evidence comes from BuilderResult

5. **Orchestrator**
   - receives the WP3 OrchestratorBundle plus an explicit JSON output contract
   - model hints never override objective gates
   - an optimistic `COMPLETE` becomes `VERIFY` if Git/runtime/acceptance/test gates are incomplete

6. **Mission Control routing**
   - `COMPLETE` → `complete`
   - `REPAIR` → `repair`
   - `RESEARCH` → `research`
   - `VERIFY` → `verification`
   - `BLOCKED` → `blocked`

## Persistent pipeline run state

Derived execution state is stored under `state.workCodexRuntime`:

- CycleReviews
- ApprovedImplementationDeltas
- Codex packets
- BuilderResults
- verification evidence
- Orchestrator decisions
- bounded errors

Mission Control remains the authoritative mission-status owner; this runtime state is execution/provenance material, not duplicate business state.

## Work conversation behavior

The conversation service now waits for the Work supervisor's assistant response, extracts JSON (plain or fenced), and fails with `WORK_RESPONSE_TIMEOUT` instead of treating a successful prompt send as a completed review.

## Fail-closed conditions

The runtime blocks the mission if:

- Work returns no `next_decision`
- `READY_FOR_CODEX` lacks a structured bounded delta
- `codex.build` or `codex.orchestrate` is unavailable
- the Codex service lacks distinct `build()` / `orchestrate()`
- builder output changes files outside packet scope
- authoritative GitHub verification is unavailable
- any pipeline contract validation fails

## Verification

Run:

```bash
node hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/codex-sidepanel/titan-workforce/work-codex-runtime.test.mjs
```

The test covers:

- READY_FOR_CODEX → builder → Git evidence → Orchestrator → COMPLETE
- missing orchestrate capability → fail closed
- malformed Work approval → fail closed
- optimistic COMPLETE with failed Git gates → VERIFY
- Orchestrator REPAIR routing
- CONTINUE_5 returning to bounded research without Codex dispatch
