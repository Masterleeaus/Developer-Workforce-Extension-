# Titan Worker Coordination v0.1

Five parallel Codex workers need collision control.

The extension now performs a local, zero-token overlap scan using:
- repository
- branch
- mission title/goal
- constraints
- acceptance criteria

High-confidence collision:
- same branch is an immediate strong conflict
- same repository plus substantial shared scope can also trigger a conflict

When two workers conflict, the lower-numbered worker continues and the higher-numbered worker enters `coordination-wait`.
No `NEXT` is sent to a waiting worker.

When the conflict disappears, the worker is released automatically.

The current algorithm is deliberately deterministic and conservative. Future repository-impact data can replace lexical overlap with actual file/symbol ownership.
