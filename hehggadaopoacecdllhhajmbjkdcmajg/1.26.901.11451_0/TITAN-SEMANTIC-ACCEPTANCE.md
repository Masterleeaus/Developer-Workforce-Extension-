# Titan Semantic Acceptance Resolution v0.1

Ambiguous acceptance criteria can now be resolved during an already-scheduled fifth-pass review.

No extra supervisor call is created.

The reviewer may prepend:

`TITAN_ACCEPTANCE: {"complete":[0],"incomplete":[1],"evidence":{"0":"brief evidence"}}`

Rules:
- criterion indexes refer to the mission's acceptance array
- unsupported worker claims are not sufficient evidence
- ambiguous criteria may remain unresolved
- the metadata line is stripped before the worker receives its next instruction
- semantic completion is recorded as `supervisor-review`

This complements deterministic Git/runtime evidence reconciliation rather than replacing it.
