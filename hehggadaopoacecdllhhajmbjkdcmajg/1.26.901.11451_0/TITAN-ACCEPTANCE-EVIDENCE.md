# Titan Acceptance Evidence Reconciliation v0.1

Acceptance criteria are now reconciled against authoritative Git/runtime evidence where wording is unambiguous.

Examples:
- CI passes → `git.ciPassed`
- merged/present on main → Git merge evidence
- deployed/installed → runtime deployment evidence
- no console errors → console evidence
- API/network succeeds → network evidence
- browser/UI works → browser evidence
- VPS/server/DirectAdmin → server evidence when available
- E2E/workflow completes → runtime acceptance evidence

Ambiguous criteria are never automatically marked complete.

Final mission verification now requires:
1. Git gate passes.
2. Runtime gate passes.
3. Every acceptance criterion is resolved complete.

If Git + runtime pass but unresolved acceptance remains, mission enters `acceptance-review` instead of being recycled.
