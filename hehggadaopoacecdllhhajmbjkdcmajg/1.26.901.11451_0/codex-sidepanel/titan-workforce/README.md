# Titan Workforce Core (WP4)

Canonical integration boundary for the 15-slot Developer Workforce.

This module deliberately does not implement WP1 profiles, WP2 five-pass queues, or WP3 Work/Codex contracts. Those packages integrate through the registry/controller.

Topology: 10 Chat workers, 2 Work supervisors, 2 Codex builders, 1 Codex orchestrator.

Legacy migration imports the five v3.0.34 worker slots into Squad A without destroying legacy audit/send/review data.

## Execution service priority

The v4 runtime prefers real stock/native providers when they are published through the stable native-service bridge. If a stock provider is unavailable, bootstrap installs bounded fail-closed fallbacks:

- Codex: bound conversation execution for Builder A/B and Orchestrator.
- GitHub: authoritative public GitHub REST verification for branch/commit/PR/CI/main containment.
- Repository: bounded public GitHub REST file/test/symbol/dependency context.

A later stock-native service event replaces the fallback in-place. `services.status()` reports the active provider source for each service.

Private/inaccessible GitHub repositories fail closed unless a native authenticated provider is available.


## Observability, metrics and replay

The v4 runtime exposes `api.observability` as the canonical append-only mission-event layer. It does not replace mission, agent, verification or provenance state.

Canonical events include mission creation/profile casting, Chat pass dispatch/completion, supervisor review, approved deltas, builder/Codex/orchestrator activity, CI/runtime/acceptance verification, mission completion, and BLOCKED/REPAIR/RESEARCH/VERIFY transitions.

Public runtime helpers:
- `api.observability.record(type, data, meta)` — append an explicit canonical event.
- `api.metrics()` — derive throughput, utilization, pass/cycle duration, review/repair/CI failure rates, MCP/tool failures, Codex completion, context/retry/stale-work and verification metrics without reading conversations.
- `api.replayEvents({ strict })` — reconstruct mission execution state from events and detect duplicate/impossible transitions.
- `api.exportDiagnostics({ missionId, eventLimit })` — export a compact `titan-workforce-diagnostics/v1` bundle containing event references, derived metrics and dry-run replay state.

Replay is deterministic and side-effect free: it never calls Git, MCP, browser, runtime, Codex or other execution services. Events retain bounded provenance/reference fields rather than full prompt/transcript payloads.

The existing free-form `auditLog` remains available for operational debugging; canonical events are derived from stable audit/lifecycle seams and stored separately in `state.eventLog`.


## Engineering cockpit and conversation lifecycle

The sidepanel cockpit is a view/controller over the background-owned 15-slot workforce. It groups:
- Squad A: A1–A5 + Supervisor A
- Squad B: B1–B5 + Supervisor B
- Builder A/B
- Orchestrator

It surfaces service/MCP/capability health, usage, mission stage/progress, approvals, scope, verification evidence, merge pressure, blocked reasons and agent conversation state. Global, squad and agent controls support pause/resume, quarantine/unquarantine and E-STOP without moving authority into the UI.

Long-lived Chat/Work conversations use `TitanConversationLifecycle`:
1. evaluate age/cycle/context/failure thresholds;
2. refuse rotation while the current turn is generating;
3. create a compact checkpoint containing mission/profile/pass/provenance/idempotency references, not full transcript history;
4. create and prime a fresh ChatGPT conversation with minimal continuation context;
5. wait for a stable `/c/...` identity before binding;
6. replace the Chat/Work conversation identity without resetting mission, scheduler, provenance or send-ledger state;
7. archive the prior identity/checkpoint reference in bounded history.

Runtime commands exposed to the cockpit include `conversationLifecycleStatus` and `rotateConversation`.
