# Titan MCP Registry / WebMCP v1

Issue #29 restores the stock extension's missing WebMCP content scripts and adds a policy-controlled MCP registry to the Developer Workforce.

## WebMCP bridge

The stock `background.js` dynamically registers:

- `content-scripts/webmcp.js` in the MAIN world
- `content-scripts/webmcp-bridge.js` in the ISOLATED world

Those files now exist.

The MAIN-world adapter uses the current WebMCP surface:

- `document.modelContext.getTools()`
- `document.modelContext.executeTool()`
- `toolchange`

The isolated bridge exposes Chrome tab messaging:

- `titan:webmcp:ping`
- `titan:webmcp:list`
- `titan:webmcp:invoke`

Each list snapshot produces opaque registration IDs. A stale registration fails before execution, so Titan may refresh once and retry safely.

## TitanMcpRegistry

The registry tracks:

- server id/name
- transport
- URL / tunnel / local config
- auth state
- trust level
- allowed execution classes
- allowed profiles
- tool catalogue
- health / latency
- discovery expiry
- last successful call / error

Supported transport labels are `webmcp`, `http`, `sse`, `stdio`, `tunnel`, and `custom`. Transport implementations are provider adapters; this issue ships the Chrome WebMCP provider.

## Tool policy

Tool classifications:

- READ
- WRITE
- DESTRUCTIVE
- EXTERNAL_SIDE_EFFECT
- SERVER_ADMIN
- SECRET_ACCESS

`readOnlyHint: true` maps to READ. Consequential hints and conservative name heuristics elevate tools when required.

All non-READ calls require explicit approval through call context or a configured approval provider. Execution-class and profile restrictions fail closed.

## Capability broker

Issue #29 adds the shared `TitanCapabilityBroker` foundation and registers:

- `mcp.list`
- `mcp.call`

Issue #28 should expand this same broker for Codex, Git, GitHub, repository, terminal, browser, runtime and server capabilities rather than creating a second broker.

## Runtime API

After Developer Workforce bootstrap:

- `window.TitanCapabilityBroker`
- `window.TitanMcpRegistry`
- `window.TitanDeveloperWorkforce.mcp`
- `window.TitanDeveloperWorkforce.services.get("mcp")`

Example:

```js
const mcp = window.TitanDeveloperWorkforce.services.get("mcp");
const server = await mcp.discoverTab(tabId);
const tools = await mcp.list(server.id);
const result = await mcp.call(
  server.id,
  "read_status",
  {},
  { executionClass: "chat_worker", profileIds: ["reliability"] }
);
```

A write tool additionally requires `approved: true` or an approval-provider result.

## Verification

The full Developer Workforce regression runs `mcp-registry.test.mjs`, covering:

- unavailable server
- cache expiry / refresh
- execution-class denial
- profile denial
- write approval
- stale WebMCP registration refresh
- broker timeout
- Chrome bridge request shape
- restored content-script contract
