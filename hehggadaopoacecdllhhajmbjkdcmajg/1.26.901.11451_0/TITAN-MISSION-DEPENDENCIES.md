# Titan Mission Dependencies v0.1

Queued missions can declare `dependsOn: [missionId, ...]`.

A dependent mission is not assignable until every dependency appears in verified mission history.

This is deterministic and consumes no Codex review tokens.

Queue behavior:
- ready missions sort before dependency-blocked missions
- priority applies within readiness groups
- blocked missions remain queued
- verification of a prerequisite naturally unlocks dependents
- unknown dependency IDs are reported by `dependencyState`

API:
`TitanMissionQueue.dependencies(mission)`

Cockpit queue status now shows:
`N ready / M waiting`

This supports mission DAGs such as:
installer → runtime activation → DirectAdmin UI → end-to-end acceptance.
