# Titan Dispatch + Backpressure v0.1

All worker prompts now pass through one local dispatcher.

Defaults:
- five worker pool remains available
- maximum 5 simultaneously generating workers
- minimum 1.5 seconds between prompt sends
- priority queue:
  1. supervisory review instructions
  2. new mission assignments
  3. ordinary NEXT continuations

Backpressure:
When 3 or more deep reviews are queued, ordinary NEXT sends pause until the review backlog drains.

E-STOP cancels pending sends.

This is a local scheduling mechanism and consumes no model tokens.
It prevents bursts of five simultaneous DOM sends and keeps expensive review/verification work ahead of routine continuation.
