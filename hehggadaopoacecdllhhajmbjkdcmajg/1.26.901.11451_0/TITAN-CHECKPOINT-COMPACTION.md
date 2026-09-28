# Titan Checkpoint Compaction v0.1

Each successful deep review now creates one compact durable checkpoint per worker.

Stored:
- mission/pass/status
- remaining acceptance criteria
- last supervisor instruction
- branch/PR/commit references
- review reason

Later reviews receive:
1. current mission contract
2. previous compact checkpoint
3. relevant architecture/repository slice
4. only recent conversation tail

Transcript cap:
- before first checkpoint: 18k characters
- after checkpoint exists: 9k characters

Normal NEXT passes remain unchanged and consume no supervisory context.

Checkpoints reset when a worker receives a new mission.
