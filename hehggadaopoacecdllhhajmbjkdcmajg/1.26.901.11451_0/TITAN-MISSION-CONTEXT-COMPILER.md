# Titan Mission Compiler + Context Compiler

Issue #31 adds deterministic mission normalization and execution-class-specific context compilation on top of the canonical v4 workforce.

## TitanMissionCompiler

Accepted source types:
- GitHub issue
- operator prompt
- repair request
- CI failure

The compiler emits the canonical Mission Contract and enriches it with:
- priority and risk
- repository / branch rules
- scope paths
- protected paths
- dependencies
- acceptance criteria
- verification/runtime/evidence requirements
- test plan
- WP1-selected required profiles
- assigned squad
- 5/10/15-pass research epoch limit
- source provenance

GitHub issue IDs are deterministic when repository + issue number are available.

The compiler does not infer broad write scope. Scope comes from explicit source fields/sections/code-path references and remains subject to normal scope-lock enforcement.

## TitanContextCompiler

Context is compiled differently for each execution class.

### Chat worker
- canonical mission summary
- WP1 profile context
- targeted architecture slice
- targeted repository slice
- latest compact checkpoint
- one specific pass instruction

### Work supervisor
- mission/profile/architecture/repository context
- up to five compact worker results
- prior supervisor checkpoint
- provenance

### Codex builder
- mission/profile/architecture/repository context
- ApprovedImplementationDelta
- relevant tests
- provenance

The delta scope must be within the mission scope. Expansion throws `CONTEXT_SCOPE_EXPANSION`.

### Codex orchestrator
- mission/profile/architecture/repository context
- bounded Approved Deltas
- bounded Builder Results
- verification evidence
- provenance

All delta scopes must remain inside the canonical mission scope.

## Context budgets

Defaults:
- chat_worker: 12,000 characters
- work_supervisor: 18,000
- codex_builder: 22,000
- codex_orchestrator: 26,000

Budgets can be tightened by configuration. Repeated identical sections are deduplicated and oversized sections are compacted/truncated.

Raw full conversation history is not injected by the compiler. Checkpoints and structured summaries are preferred.

## Runtime API

The v4 bootstrap exposes:
- `TitanDeveloperWorkforce.missionCompiler`
- `TitanDeveloperWorkforce.contextCompiler`

The Context Compiler consumes the #30 repository/architecture context through the existing integration seam and preserves provenance from the canonical provenance graph.
