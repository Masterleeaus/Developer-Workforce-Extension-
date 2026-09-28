# Titan Agent Profiles & Dynamic Casting v1

Agent 1 / WP1 package for the 15-slot Developer Workforce Extension.

## Purpose

Profiles are composable configuration/knowledge packages. They are **not running agents** and do not own Titan business state. A cast contains one primary profile plus zero or more secondary lenses, then compiles to deterministic context suitable for Chat, Work or Codex injection.

Supported execution classes:
- `chat_worker`
- `work_supervisor`
- `codex_builder`
- `codex_orchestrator`

This package deliberately does not modify supervisor timing, the five-minute scheduler, Work→Codex routing, GitHub Truth, runtime verification or browser automation.

## Public API

Browser global: `window.TitanAgentProfiles`

Node/CommonJS: `require("./titan-agent-profiles.js")`

Stable API:
- `EXECUTION_CLASSES`
- `GLOBAL_INVARIANTS`
- `AgentProfileRegistry`
- `registry`
- `registerProfile(profile, options)`
- `getProfile(idOrName)`
- `listProfiles(options)`
- `composeProfiles(primary, secondary, options)`
- `selectProfilesForMission(mission, options)`
- `compileProfileContext(compositionOrMission, options)`
- `validateExecutionClass(profileOrId, executionClass)`
- `adaptMissionControlMission(mission, options)`

## Profile schema

Every normalized profile exposes:
- id / name
- role
- domain
- expertise
- architecture context
- invariants
- preferred execution class
- compatible execution classes
- allowed capabilities
- verification requirements
- output contract
- risk/policy hints
- scope patterns / tags
- primary/secondary composition rules

Global Titan invariants are merged into every profile: fail-closed tenancy, no duplicate business state, Authority/ExecutionGateway preservation, idempotency/correlation/evidence, one-branch discipline, evidence-first truth and preserved verification controls.

## Catalogue

The initial catalogue contains 52 profiles: all specialisms required by WP1 plus observability/telemetry, concurrency/idempotency, data/privacy, search/indexing, notifications, forms/evidence capture, assets/locations and pricing/margins.

Profiles are configuration. Registering one never starts or reserves a workforce slot.

## Deterministic Mission Contract selection

`selectProfilesForMission()` consumes existing Mission Control-compatible fields when present:
- title / goal
- repo / repository / branch
- domain / surface / subsystem
- constraints
- acceptance
- tags
- files / paths
- executionClass / execution_class
- explicit primaryProfile / profile / profileId / domainProfile
- explicit secondaryProfiles / lenses

Explicit profile fields win. Otherwise fixed scope-pattern scoring is used. Ties use a fixed profile-priority list and profile id, so repeated input returns the same cast. If nothing matches, `architecture` is the primary fallback.

Example:

```js
const cast = TitanAgentProfiles.selectProfilesForMission({
  id: "M-42",
  title: "Harden CRM tenant isolation",
  goal: "Fail closed for cross-company API requests",
  constraints: ["preserve company_id"],
  acceptance: ["cross-company access denied"]
}, { executionClass: "work_supervisor" });
```

## Composition

```js
const cast = TitanAgentProfiles.composeProfiles(
  "crm",
  ["tenant-isolation", "security"],
  { executionClass: "work_supervisor" }
);
```

Rules:
1. Exactly one primary profile.
2. Zero or more unique secondary lenses.
3. Primary and lenses must all support the selected execution class.
4. Profiles may opt out of primary or secondary use.
5. Composition creates no agent runtime state.

## Compiled context

```js
const compiled = TitanAgentProfiles.compileProfileContext(cast);
```

`compiled.text` contains the execution class, primary/lens identities, expertise, architecture context, allowed capabilities, verification requirements, deduplicated invariants, output contract and risk/policy hints.

## Existing Mission Control adapter

```js
const adapted = TitanAgentProfiles.adaptMissionControlMission(existingMission, {
  executionClass: "chat_worker"
});
```

The returned `mission` is the same object reference. The adapter only adds cast metadata/context alongside it; it does not copy or replace canonical mission/business state.

## Agent 4 integration

Recommended `TitanWorkforceController` integration:
1. Read/normalize the existing Mission Contract.
2. Resolve the destination slot execution class.
3. Call `selectProfilesForMission(mission, { executionClass })`.
4. Call `compileProfileContext(cast)`.
5. Inject `compiled.text` into the Chat, Work or Codex instruction envelope.
6. Persist only selected profile ids if audit/replay needs them; do not persist copied profile definitions as business state.
7. Preserve selected ids for replay, or reselect only when mission/profile override fields change.

Agent 4 can choose the final loading/import seam while modularizing the legacy supervisor. WP1 intentionally does not edit the supervisor monolith or `manifest.json`.

## Extension mechanism

Use `registerProfile()` for the singleton registry or instantiate `AgentProfileRegistry`.

Duplicate ids fail closed unless `{ replace: true }` is supplied explicitly.

## Tests

From `codex-sidepanel`:

```bash
node tests/titan-agent-profiles.test.js
```

Coverage:
- profile/catalogue lookup
- profile composition
- execution-class compatibility
- deterministic Mission Contract selection
- compiled injection context
- extension registration
- backward-compatible Mission Control adapter

## Assumptions

- Current Mission Control fields remain backward-compatible with the existing `normalizeMission()` contract.
- Capability names in profiles are declarative allow/handoff hints; runtime authorization remains owned by Authority/workforce integration.
- Agent 4 owns final supervisor/controller integration and conflict resolution.
