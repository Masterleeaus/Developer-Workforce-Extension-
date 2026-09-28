# Titan Objective Mission Progress v0.1

Mission Control now calculates an operational progress indicator from factual state.

Inputs:
- acceptance criteria completed
- Git evidence: commit / CI / merged / present on main
- runtime evidence: deployment / browser / console / network / acceptance / server
- pass-budget consumption
- blocked/failure state

This is **not** an AI quality score and does not judge code quality.
It is a compact completion/efficiency indicator for orchestration.

Weights:
- acceptance: 35%
- Git verification: 30%
- runtime verification: 25%
- remaining pass budget: 10%
- blocked state: -10 points

API:
`TitanProgress.mission(workerIndex)`
`TitanProgress.team()`

The cockpit displays the percentage beside each active mission, and convergence snapshots retain the factual components.
