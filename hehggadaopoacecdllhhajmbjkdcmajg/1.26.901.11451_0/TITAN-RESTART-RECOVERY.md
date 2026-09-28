# Titan Crash / Restart Recovery v0.1

On side-panel/Chrome restart Titan now:

1. Loads persisted missions, counters, checkpoints, leases, queue and audit history.
2. Forces the supervisor DISARMED.
3. Rechecks every bound worker tab.
4. Restores message-count baselines for unchanged conversations.
5. If a worker produced replies while Titan was offline, queues a **restart-reconciliation deep review**.
6. Does not send NEXT automatically across an offline gap.
7. Requires explicit Arm after reconciliation.

This prevents duplicate NEXT/review actions after Chrome restoration.

`window.TitanRecovery`
- `reconcile()`
- `report()`
- `clean()`

Latest report is also available as `window.__titanRecoveryReport`.
