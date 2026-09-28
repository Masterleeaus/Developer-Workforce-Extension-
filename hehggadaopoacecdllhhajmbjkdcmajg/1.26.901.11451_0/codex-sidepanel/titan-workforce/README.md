# Titan Workforce Core (WP4)

Canonical integration boundary for the 15-slot Developer Workforce.

This module deliberately does not implement WP1 profiles, WP2 five-pass queues, or WP3 Work/Codex contracts. Those packages integrate through the registry/controller.

Topology: 10 Chat workers, 2 Work supervisors, 2 Codex builders, 1 Codex orchestrator.

Legacy migration imports the five v3.0.34 worker slots into Squad A without destroying legacy audit/send/review data.
