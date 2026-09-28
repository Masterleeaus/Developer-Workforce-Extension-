# Titan Supervisor Audit Log v0.1

The supervisor now keeps a bounded append-only operational event log (last 1,000 events).

Recorded examples:
- arm/disarm/E-STOP
- automatic NEXT/review/mission prompt sends
- mission queued/assigned/completed
- deep review start/completion
- GitHub verification
- runtime verification
- team convergence

The audit record stores compact metadata and short prompt previews, not full conversations.

API:
- `TitanAudit.list(limit)`
- `TitanAudit.export()` → JSON
- `TitanAudit.clear()`

This allows reconstruction of why the autonomous supervisor acted without consuming Codex tokens or rereading worker chats.
