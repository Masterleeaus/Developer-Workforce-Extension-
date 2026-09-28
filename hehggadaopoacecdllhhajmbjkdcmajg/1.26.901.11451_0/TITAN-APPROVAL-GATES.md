# Titan High-Impact Approval Gates v0.1

Routine autonomous actions remain autonomous:
- NEXT
- scheduled deep review
- deterministic coordination
- evidence verification
- compatible mission recycling

High-impact exceptions have an explicit approval mechanism:
- override verification
- override unresolved acceptance
- override ownership conflict
- change mission scope
- force complete
- force recycle
- cross-repository write

Current public controlled methods:
- `TitanMissionControl.forceComplete(workerIndex)`
- `TitanMissionControl.overrideOwnership(workerIndex)`

Calling one without a matching recent approval creates a pending approval and does nothing.

Approval API:
- `TitanApprovals.pending()`
- `TitanApprovals.approve(id, note)`
- `TitanApprovals.deny(id, note)`
- `TitanApprovals.list()`

Approvals expire for matching purposes after 30 minutes and are included in the audit trail.
