# Titan Adaptive Utilization Fairness v0.1

Pressure throttling no longer favors W1/W2.

Routine continuation slots are granted to eligible workers with the oldest `lastAdvanceAt` timestamp.

Properties:
- fair rotation across W1–W5
- stable grant set for one inspection cycle
- deep reviews/exceptions unaffected
- new/recycled missions reset their advance timestamp and receive fair opportunity
- review phase offsets remain unchanged

A deterministic simulation at target concurrency 2 over 50 cycles produced equal continuation counts across all five workers.
