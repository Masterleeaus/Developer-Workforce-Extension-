# Titan Mission Budgets + Anti-loop v0.1

Default mission budget:
- 25 worker completions
- 6 deep reviews
- 180 minutes

A mission exceeding a budget stops automatic NEXT and enters attention/review.

The extension also keeps compact local fingerprints of recent worker completions.
Three consecutive completion summaries with >92% token-set similarity trigger an anti-loop escalation.

This logic is local and consumes no Codex tokens until escalation.

Mission-specific budgets may override:
`budget: { maxPasses, maxReviews, maxMinutes }`

The goal is not to terminate difficult work prematurely; it is to prevent unattended workers consuming allowance while making no measurable progress.
