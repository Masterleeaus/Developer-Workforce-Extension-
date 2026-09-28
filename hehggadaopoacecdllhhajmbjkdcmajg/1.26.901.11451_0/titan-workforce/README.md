# Titan Chat Five-Pass Scheduler — WP2

Agent 2 package for issue #6. This directory is intentionally isolated from the legacy 5×5 supervisor so Agent 4 can integrate it into the canonical workforce refactor.

## Runtime roster
- Squad A: A1–A5
- Squad B: B1–B5
- execution class: `chat_worker`

## Public API
Global/browser: `window.TitanChatFivePass`

Node/CommonJS: `require("./chat-five-pass-scheduler.js")`

Exports: `STATES`, `EVENTS`, `DEFAULT_GATE_MS`, `ChatFivePassScheduler`.

Key methods:
- `startCycle(workerId, { missionId, cycleId, queue })`
- `inspectGate(workerId, observation)`
- `confirmDispatch(workerId, key)`
- `completePass(workerId, result)`
- `bindConversation()` / `assertConversation()`
- `setSlowdown()`
- `pauseWorker()` / `resumeWorker()`
- `pauseSquad()` / `resumeSquad()`
- `quarantine()` / `block()`
- `snapshot()` and `ChatFivePassScheduler.restore(snapshot)`

## Scheduling contract
A gate is permission to advance, never permission to interrupt.

- Busy at gate: no send; defer by the current effective gate interval.
- Finished and passes remain: return the next precompiled specific instruction.
- Pass 5 completed: `CYCLE_COMPLETE` and emit `supervisor_review_required`.
- Blocked: `BLOCKED`; usage/restriction: `PAUSED`.
- Default minimum gate is five minutes and cannot be configured lower.
- Slowdown levels are normal 5m, moderate 10m, high 15m.
- Squad A workers are staggered. Squad B is internally staggered and offset from A.
- Idempotency key: `mission/cycle/worker/pass`.
- Conversation identity is locked fail-closed.
- Restart restoration converts unknown in-flight `BUSY` state to `WAITING_GATE` and imposes a fresh minimum gate before any retry.

## Stable events
- `cycle_started`
- `pass_dispatched`
- `worker_busy`
- `pass_completed`
- `cycle_complete`
- `blocked`
- `supervisor_review_required`

## Integration boundary
This package does not send browser prompts, reason about Work Supervisor output, invoke Codex, or perform profile casting.

The host should:
1. Call `inspectGate`.
2. If action is `dispatch`, verify the destination conversation identity and send the supplied `instruction`.
3. Only after a successful send call `confirmDispatch`.
4. When generation actually completes call `completePass`.
5. Consume `supervisor_review_required` after pass 5.

Persist `snapshot()` through the canonical workforce state store. Agent 4 should migrate useful legacy W1–W5 state into A1–A5 while preserving existing send-ledger/audit data where applicable.

## Tests
Run:

```bash
node titan-workforce/chat-five-pass-scheduler.test.js
```

The suite uses a simulated clock and never waits five real minutes.

## Legacy migration and mission guards

`chat-five-pass-integration.js` adds two integration seams:

- `migrateLegacyFiveByFive(legacyState)` maps useful W1–W5 runtime state into A1–A5 and leaves B1–B5 fresh.
- `GuardedChatFivePassScheduler` accepts an `advanceGuard(worker, dispatch)` callback. Agent 4 should connect the existing mission-budget and anti-loop evaluator here so WP2 cannot bypass those controls.

The guard runs immediately before dispatch. A denied verdict blocks the worker and emits the normal blocked audit event rather than silently continuing.

## Migration notes

Recommended v3.0.34 migration:

1. Preserve existing conversation identity, mission/cycle IDs, pass count, queue, last dispatch, next due time, health, pause/block state, action keys and recent audit history.
2. Map legacy `W1`–`W5` to `A1`–`A5`.
3. Initialize `B1`–`B5` as fresh `chat_worker` slots.
4. Preserve the existing canonical send ledger outside this package and use its result together with WP2's deterministic pass key.
5. Restore through the canonical workforce state store, then reconcile live browser generation state before allowing the next gate.
