# Titan Execution Capability Broker

Issue #28 makes `TitanCapabilityBroker` the canonical execution boundary between the 15-agent workforce and concrete Codex/Git/GitHub/repository/terminal/browser/runtime/server/MCP implementations.

## Design rule

Agents and profiles request **capabilities**, not stock bundle implementation objects.

Examples:

- `repo.search`
- `repo.read`
- `repo.diff`
- `git.status`
- `git.branch`
- `git.commit`
- `git.merge`
- `git.worktree`
- `github.status`
- `github.issue`
- `github.pr`
- `github.actions`
- `codex.thread.start`
- `codex.thread.resume`
- `codex.turn.start`
- `codex.turn.steer`
- `codex.turn.interrupt`
- `codex.build`
- `codex.orchestrate`
- `terminal.exec`
- `terminal.test`
- `terminal.build`
- `browser.inspect`
- `browser.console`
- `browser.network`
- `browser.screenshot`
- `runtime.verify`
- `server.inspect`
- `server.deploy`
- `mcp.list`
- `mcp.call`

Capabilities are registered only when an underlying execution service can provide them. Missing capabilities fail closed.

## Stable stock/native seam

Titan never imports hashed/minified stock extension modules.

`titan-stock-native-adapters.js` accepts a dependency-injected stock host and publishes normalized services through `titan:stock-native-service`.

Supported host families:

- Codex / app-server
- Git
- GitHub
- repository/workspace
- terminal
- browser
- runtime
- server

Verified Codex request names in this extension family include:

- `thread/start`
- `thread/resume`
- `turn/start`
- `turn/steer`
- `turn/interrupt`

Git keeps the stable `request({method, params, signal})` seam.

## Capability policy

Execution-class defaults are defined in `execution-capabilities.js`.

- Chat workers are read/research oriented.
- Work supervisors receive review/verification-oriented read capabilities.
- Codex builders receive bounded build/Git/terminal capabilities.
- The Codex orchestrator receives final QA/verification capabilities.

WP1 profile `allowedCapabilities` values are mapped through capability aliases. Existing `read_repo` expands into repository read/search/diff capabilities.

The active allowed-capability set is passed to the broker for builder/orchestrator calls, so an agent cannot invoke a capability outside its execution/profile context merely because a native service exists.

## Safety and reliability

The broker provides:

- structured unavailable/denied/timeout/abort errors
- per-capability timeout
- AbortSignal propagation
- health counters
- last-success/failure/latency
- audit events for calls, completion, denial and failure
- classification of read/write/destructive/server/secret actions

Issue #34 owns the broader high-impact approval and credential policy. The broker is the enforcement point for that policy.

## Runtime integration

Bootstrap creates:

- `TitanExecutionServices`
- `TitanCapabilityBroker`
- `TitanMcpRegistry`

After fallbacks/native services are installed, `installExecutionCapabilities()` synchronizes service methods into broker capabilities. A later `titan:stock-native-service` event triggers resynchronization so native services can replace fallbacks without restarting the workforce.

Builder and orchestrator execution in `TitanWorkforceIntegration` now routes through the broker.

## Verification

`execution-capabilities.test.mjs` verifies:

- Git status/diff through the broker
- terminal test execution
- raw Codex app-server request mapping
- bounded Codex builder packet routing
- execution-class denial
- missing capability failure
- timeout cancellation
- external cancellation
- health and audit reporting
- complete stock-host service publication
- workforce builder dispatch traversing the broker
- no direct hashed/minified asset imports
