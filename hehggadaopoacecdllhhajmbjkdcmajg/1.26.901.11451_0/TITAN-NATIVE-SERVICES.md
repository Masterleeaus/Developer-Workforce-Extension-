# Titan Native Service Binding v0.1

Titan now auto-binds four capabilities:

- `codex.review(job)`
- `github.verify({workerIndex, mission})`
- `repository.query({workerIndex, mission, transcript, limit})`
- `runtime.verify({workerIndex, mission, requirements})`

## Publishing adapters

Preferred:

```js
window.TitanNativeServices.publish("codex", codexAdapter)
window.TitanNativeServices.publish("github", githubAdapter)
window.TitanNativeServices.publish("repository", repositoryAdapter)
window.TitanNativeServices.publish("runtime", runtimeAdapter)
```

Titan also probes:
- `window.__codexNativeServices`
- `window.__chatgptNativeServices`
- `window.__titanNativeBridge`

This avoids coupling Titan to hashed/minified Vite bundle export names.

## Stock primitives mapped in this build

Codex app-server:
`thread/start`, `thread/resume`, `thread/goal/set`, `turn/start`, `turn/steer`, `turn/completed`.

GitHub/workspace:
Titan's adapter contract expects authoritative branch/commit/PR/CI/main evidence.

Repository:
Relevant files/tests/symbols/dependency edges.

Runtime:
The build now includes a conservative Chrome-debugger adapter using existing extension permissions.
It can verify page reachability/debugger access. It deliberately does not claim VPS/server verification.

The cockpit shows native binding state:
C = Codex, G = GitHub, R = Repository, V = Runtime.
