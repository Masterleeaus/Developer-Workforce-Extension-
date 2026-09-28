# Titan Usage Governor

Issue #32 adds a deterministic global pressure layer for ChatGPT/Codex plan-aware execution.

## States

- NORMAL
- ELEVATED
- CONSERVE
- RESTRICTED
- RECOVERY

The governor persists in canonical v4 workforce state under `state.usageGovernor`.

## Signals and accounting

Global and per-mission counters track:
- Chat turns
- Work/supervisor cycles
- Codex turns
- retries
- repair cycles
- context characters
- pass durations
- active Chat/Codex concurrency
- restriction signals

Pressure can also include review backlog, CI backlog and native-service failures.

## Policies

| State | Chat dispatch slots | WP2 slowdown | Codex concurrency | Context budget |
|---|---:|---|---:|---:|
| NORMAL | 10 | normal (5m) | 2 | 100% |
| ELEVATED | 7 | normal (5m) | 2 | 85% |
| CONSERVE | 5 | moderate (10m) | 1 | 65% |
| RESTRICTED | 2 | high (15m) | 0 | 45% |
| RECOVERY | 4 | moderate (10m) | 1 | 60% |

The governor never asks WP2 to run faster than its configured minimum gate.

## Runtime integration

### Chat
All bound workers continue to be observed so in-flight completion is never lost. The governor only limits **new pass dispatches**. Higher-priority and verification/repair missions are ranked ahead of routine research when dispatch capacity is reduced.

### Codex
Builder and Orchestrator execution is admitted through `allowCodex()`. Restricted state blocks new Codex work and other states enforce bounded active concurrency.

### Context
The #31 Context Compiler scales its hard class-specific budgets through `usageGovernor.contextLimit()` and records emitted context size back into mission usage accounting.

## Recovery

A restriction signal transitions immediately to RESTRICTED. When the external restriction clears, `clearRestriction()` enters RECOVERY for a configurable recovery interval before normal pressure evaluation resumes.

Mission/scheduler state is never discarded during throttling.

## Visibility

The Engineering Cockpit shows:
- governor state
- allowed Chat concurrency
- allowed Codex concurrency
- context budget percentage

Preflight confirms the governor is installed and reports its current policy.

## API

`TitanDeveloperWorkforce.usageGovernor`

Key methods:
- `record(type, data)`
- `evaluate(signals)`
- `clearRestriction()`
- `policy()`
- `contextLimit(base)`
- `allowedChatSlots(slots, missions)`
- `allowCodex(context)`
- `status()`
