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