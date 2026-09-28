# Titan Adaptive Worker Utilization v0.1

The workforce remains five slots, but Titan can temporarily reduce how many workers receive routine NEXT continuations.

Pressure inputs:
- review backlog
- worker conflicts
- verification backlog
- blocked/attention missions
- dispatch backlog

Targets:
- low pressure → 5 active
- moderate → 4
- pressure → 3
- high pressure → 2

Deep reviews, failures and exception handling are not suppressed.
Only routine continuation is held.

As pressure clears, target concurrency automatically returns toward five.

This is local deterministic control and consumes no Codex tokens.
