# Titan Repository Intelligence & Architecture Index

Issue #30 adds a persistent repository graph and a versioned Titan architecture index for bounded mission context.

## Repository graph

`TitanRepositoryIntelligence` indexes:
- files
- symbols/classes/functions
- imports/dependency edges
- routes/APIs
- SQL tables
- tests
- migrations
- engines/gateways
- surfaces/plugins/runtime classifications
- optional ownership
- bounded change history

Indexes are keyed by `repository@commit`. The latest key per repository is persisted in the canonical v4 workforce state.

### Incremental refresh

`applyChanges({ repository, baseCommit, nextCommit, changes })` clones the prior index and updates only changed/removed files, then rebuilds dependency/duplicate metadata.

The v4 bootstrap listens for:

`titan-workforce:merge-complete`

with:

```js
{
  repository,
  baseCommit,
  nextCommit,
  changes: [{ path, status, content, sha }]
}
```

This keeps merge updates incremental rather than rebuilding the entire repository.

### Mission slices

`repositoryIntelligence.query(mission)` returns bounded:
- relevant files
- symbols
- affected tests
- dependency edges
- duplicate-symbol warnings
- commit/staleness metadata

`impact(repository, commit, changedPaths)` walks reverse dependency edges and returns impacted files/tests.

## Titan architecture index

`TitanArchitectureIndex` is explicitly versioned. The first catalogue covers:
- tenancy
- Authority / ExecutionGateway mutation path
- canonical business state
- mobile/PWA contracts
- DirectAdmin/server boundary
- Developer Workforce topology/provenance
- Commerce source-of-truth rules
- verification/evidence requirements

`compile(mission)` selects only mission-relevant entries and emits a compact architecture slice.

## Workforce integration

`TitanWorkforceIntegration.contextForMission(missionId, options)` returns:

```js
{
  missionId,
  architecture,
  repository,
  impact
}
```

This is the stable bounded-context seam for Chat workers, Work supervisors, Codex builders and the Orchestrator. It does not duplicate business state.

## Staleness

Repository slices carry the indexed commit. `isStale(repository, commit)` compares that commit to the latest indexed commit and causes historical slices to be explicitly marked stale rather than silently treated as current.
