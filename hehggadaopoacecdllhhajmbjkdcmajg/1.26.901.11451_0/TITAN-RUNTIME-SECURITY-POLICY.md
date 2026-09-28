# Titan Runtime Verification, Credential Broker & High-Impact Policy

Issue #34 adds three security/governance layers to the canonical v4 workforce runtime.

## 1. Mission-specific runtime verification

Module: `codex-sidepanel/titan-workforce/runtime-verifiers.js`

Supported verifier kinds:
- browser/UI
- console/network
- API
- SQLite/database
- PWA/offline
- authentication
- company/tenant isolation
- Authority/ExecutionGateway mutation path
- DirectAdmin/server/plugin
- deployment/install/upgrade
- field job lifecycle/evidence

Mission contracts select required checks through `runtimeRequirements`.

Public APIs:
- `TitanRuntimeVerifierRegistry`
- `runtimeVerificationPlan(mission)`
- `verifyMissionRuntime(mission, options)`
- `recordMissionRuntimeGate(verificationState, result)`

Runtime verification remains independent from Git and CI gates.

## 2. Credential capability broker

Module: `codex-sidepanel/titan-workforce/credential-broker.js`

The broker persists only safe metadata and opaque leases. Raw secrets are not stored in workforce state.

Each registered credential capability can constrain:
- capability/name
- scope
- repository
- server
- expiry
- execution classes
- profiles
- approval state

Agents request an opaque lease, then invoke a bounded executor through the broker. There is no `getSecret()` API.

The broker records:
- registration
- lease creation/revocation
- execution start/success/failure
- expiry pruning

Executor functions are intentionally not persisted and must be re-registered after restart by the owning integration.

## 3. High-impact policy

Module: `codex-sidepanel/titan-workforce/high-impact-policy.js`

Routine operations remain automatic, including reads/tests and ordinary write capabilities unless another policy restricts them.

Approval is required for high-impact actions such as:
- merge main
- production/server deploy
- destructive migration
- server restart
- tenant/company-boundary changes
- secret/credential access
- capabilities classified as DESTRUCTIVE, EXTERNAL_SIDE_EFFECT, SERVER_ADMIN or SECRET_ACCESS

The canonical v4 bootstrap installs this authorizer on `TitanCapabilityBroker` using the existing `TitanApprovalStore`.

## Runtime integration

Both:
- `bootstrap.js`
- `runtime-core.js`

now expose:
- `credentials`
- `runtimeVerifiers`
- `verifyMissionRuntime(missionId)`

The capability broker uses `createHighImpactAuthorizer()` by default.

## Verification

CI workflow:
`.github/workflows/issue-34-runtime-security.yml`

Tests:
`runtime-security-policy.test.mjs`

The test suite verifies:
- mission-specific runtime plans
- runtime gate recording
- blocked verification when providers are absent
- scoped credential leases
- approval-gated credential use
- repository/execution-class/profile restrictions
- automatic routine capability execution
- approval-gated merge and server operations
- existing core/capability/background-runtime regressions
