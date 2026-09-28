# Titan Ownership Leases v0.1

Coordination now supports concrete resource ownership in addition to lexical mission overlap.

A worker can lease:
- repository file paths
- symbols
- later: capabilities/subsystems

Repository Context automatically supplies file/symbol candidates at deep-review boundaries.

Rules:
- first worker to claim a resource owns it
- a later conflicting claimant enters `coordination-wait`
- leases refresh when seen again
- default TTL: 30 minutes
- leases release when the mission verifies or is cleared
- stale leases are pruned automatically

API:
`window.TitanOwnership.claim(worker, resources, source)`
`window.TitanOwnership.release(worker)`
`window.TitanOwnership.list()`
`window.TitanOwnership.worker(worker)`

This keeps ordinary NEXT passes zero-token while giving deep reviews concrete cross-worker collision protection.
