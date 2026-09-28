# Titan 5×5 — Native Codex integration contract

## Verified stock-extension primitives

The bundled Codex app-server request scheduler recognizes:
- `thread/start`
- `thread/resume`
- `thread/goal/set`
- `turn/start`
- `turn/steer`
- `turn/interrupt`

The stock extension also subscribes to:
- `thread/started`
- `turn/started`
- `turn/completed`
- agent-message deltas

Cloud Automation persists/query scheduled automation state through `/automations` endpoints. It is not treated as the model executor.

## Stable Titan boundary

Titan deliberately does not import minified stock-bundle export names. Those names are build artifacts and will change on extension updates.

The stock host layer should install its current native Codex implementation with:

```js
window.installTitan5x5NativeCodex({
  async review(job) {
    // use the stock AppServerManager:
    // 1. thread/start (or resume a compact dedicated internal review thread)
    // 2. turn/start with job.instruction + job.transcript
    // 3. wait for turn/completed
    // 4. return final agent instruction text
  }
})
```

This provides an upgrade-resistant seam between Titan and the stock ChatGPT/Codex extension.

## Fail-closed behavior

A worker due for a fifth-pass review does not receive `NEXT` until a native review provider returns a non-empty instruction.
Ordinary non-review passes continue using deterministic `NEXT`.
