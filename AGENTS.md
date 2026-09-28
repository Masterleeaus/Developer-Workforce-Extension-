# Agent Instructions

## Target architecture
15 active AI slots: 10 Chat workers, 2 Work supervisors, 2 Codex builders, 1 Codex orchestrator. Titan is the deterministic control plane.

## Branch discipline
- One agent, one active branch/worktree.
- Do not open a second branch until the first is merged/closed.
- Fetch current main before editing.
- Preserve and refactor useful existing code; do not duplicate engines/state.

## Work packages
WP1 Profiles & Dynamic Casting
WP2 Five-Minute Chat Squads
WP3 Work → Codex Pipeline
WP4 Core/Integration

## Invariants
- Five-minute Chat gates are minimum intervals; never interrupt a busy worker.
- GitHub/CI/runtime evidence outrank agent claims.
- Preserve fail-closed tenancy, idempotency, actor/correlation/evidence and existing Titan architecture.
- Maintain provenance Mission → Chat passes → Work review → Approved Delta → Codex → Orchestrator → verification.
- Work packages publish stable interfaces and minimize cross-package edits.
