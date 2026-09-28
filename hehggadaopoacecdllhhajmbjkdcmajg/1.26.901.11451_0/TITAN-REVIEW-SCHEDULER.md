# Titan Stagger-Preserving Review Scheduler v0.1

Policy profiles determine how frequently a worker becomes eligible for review.
The review scheduler now determines who receives the scheduled review slot.

Rules:
- at most one normal scheduled deep review is granted per supervisor polling cycle
- round-robin cursor preserves fairness
- standard five-pass workers retain their stagger
- sensitive/production workers become eligible sooner but do not create review bursts
- blocker/failure/completion/restart/budget exceptions bypass the normal slot

This preserves the original design goal: supervision load is distributed rather than all five workers invoking expensive review simultaneously.
