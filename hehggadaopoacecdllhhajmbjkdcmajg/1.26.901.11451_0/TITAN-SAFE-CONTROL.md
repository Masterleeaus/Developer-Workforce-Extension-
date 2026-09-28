# Titan 5×5 Safe Control v0.1

v3.0.14 introduces an explicit arming gate.

The supervisor cannot send worker prompts until:
1. Preflight passes.
2. All five worker tabs are ready.
3. Native Codex deep-review provider is bound.
4. User explicitly presses **Arm**.

Persisted Chrome state alone cannot restart automation after an unsafe state.

## Controls
- **Arm** — runs readiness checks and starts only on success.
- **Disarm** — stops automation without destroying mission state.
- **E-STOP** — immediately stops scheduling, preserves any active review by re-queueing it, and marks all workers emergency-stopped.
- **Reset counters** — now disarms first.

## Automatic fail-safe
Losing a bound worker tab while armed automatically disarms the supervisor.

This is intentionally conservative for the first live five-agent tests.
