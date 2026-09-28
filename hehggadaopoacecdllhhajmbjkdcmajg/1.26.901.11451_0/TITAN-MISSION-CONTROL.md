# Titan Mission Control v0.1

Mission Control is a thin structured-state layer above the 5×5 Supervisor. It does not execute code.

Each W1–W5 slot can persist:
- mission id/title/goal
- priority
- repository
- branch constraint
- architectural/operational constraints
- acceptance criteria with completion flags
- status/blocker
- PR/commit references

## Review integration
A fifth-pass review receives the worker's compact mission contract plus recent transcript.

The following worker signals escalate immediately instead of waiting for the fifth pass:
- blocker / clarification / permission failure / merge conflict
- completion or ready-to-merge claim
- test, CI, build or fatal failure

Normal healthy completions still receive deterministic `NEXT`.

## API
`window.TitanMissionControl`
- `assign(workerIndex, mission)`
- `get(workerIndex)`
- `list()`
- `update(workerIndex, patch)`
- `markAcceptance(workerIndex, criterionIndex, done)`
- `clear(workerIndex)`

This is intentionally independent from GitHub truth. GitHub verification is the next layer.
