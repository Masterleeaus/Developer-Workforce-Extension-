# Titan Team Convergence v0.1

A convergence round runs after all five workers have produced a new deep-review checkpoint since the previous round.

It compares only compact structured state, not full conversations.

Checks:
- active mission overlap
- concrete ownership conflicts
- blocked/attention/verification-failed workers
- queued missions newly eligible through dependency completion
- worker mission/status snapshot

The result is stored in a bounded 20-round history and exposed as:
`window.TitanConvergence`
`window.__titan5x5Convergence`

Convergence itself uses no Codex tokens. It updates deterministic coordination before the next five-review round.
