# Titan 5×5 deterministic self-test

v3.0.11 adds an in-extension Self-test control.

It verifies:
- five worker slots
- phase offsets W1=1 ... W5=5
- exactly one scheduled review per worker per five completions
- four deterministic NEXT actions per worker per five completions
- the cadence remains correct over two cycles
- Git + runtime gates must both pass for final completion

This test does not consume Codex tokens and does not modify live worker conversations.

A live five-tab smoke test remains separate because it requires authenticated active Codex conversations.
