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
