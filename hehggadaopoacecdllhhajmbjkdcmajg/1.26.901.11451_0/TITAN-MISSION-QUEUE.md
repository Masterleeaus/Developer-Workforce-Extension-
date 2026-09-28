# Titan Mission Queue + Worker Recycling v0.1

Verified workers can now be reused automatically.

Flow:
1. Runtime + Git verification marks current mission verified.
2. Completion record moves to bounded mission history.
3. Resource leases release.
4. Supervisor chooses the highest-priority compatible queued mission.
5. Worker pass counters reset for the new mission.
6. A compact mission contract is sent into the existing worker conversation.
7. The worker resumes the normal 5×5 cadence.

Compatibility rejects queued missions that strongly overlap active worker missions.

API:
- `TitanMissionQueue.add(mission)`
- `TitanMissionQueue.list()`
- `TitanMissionQueue.history()`
- `TitanMissionQueue.recycle(worker)`
- `TitanMissionQueue.recycleAll()`

The cockpit includes a simple Queue Mission control for testing.
