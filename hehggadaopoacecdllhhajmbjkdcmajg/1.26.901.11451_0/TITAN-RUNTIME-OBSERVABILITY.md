# Titan Runtime Observability

The Developer Workforce Extension now exposes a bounded, privacy-conscious runtime diagnostic stream at:

`window.TitanRuntimeObservability`

It loads before the v4 workforce bootstrap so bootstrap/native-adapter failures are observable even when the workforce does not finish initializing.

## Captured sources

The sidepanel automatically captures:

- global `error`
- `unhandledrejection`
- `titan-workforce:error`
- `titan:stock-native-error`
- explicit `titan:runtime-error`

Stable Titan code can also call:

```js
await window.TitanRuntimeObservability.guard(
  "native-host",
  "connect",
  () => connectNativeHost()
);
```

Failures are recorded and then rethrown, so observability never converts failure into false success.

## Privacy and safety

Diagnostic records:

- redact fields matching token/secret/password/authorization/cookie/credential/API-key names
- strip URL query strings/fragments
- truncate long values
- bound nested depth and collection sizes
- never store full stack traces or page content by default
- keep at most 200 events
- collapse repeated identical failures within a 30-second window

## API

- `record({ subsystem, operation, error, detail, severity })`
- `list()`
- `status()`
- `clear()`
- `guard(subsystem, operation, fn, options)`

The current snapshot is also mirrored to `window.__titanRuntimeDiagnostics`.

## Error categories

Current categories include:

- permission
- native-host
- storage
- auth
- media
- messaging
- network
- script-injection
- runtime

## Intended integration

Preflight/diagnostics may read `TitanRuntimeObservability.status()` but this module does not own preflight policy. It is deliberately isolated from Issue #22 so runtime error capture and health policy remain separate concerns.

## Known upstream dormant/unsupported paths

These should be reported as disabled/unsupported rather than treated as Titan runtime failures:

- upstream feature-gated WebMCP files absent from this OpenAI build
- production browser-tab-context restrictions where explicitly enforced by upstream
- generic upstream `file://`, `ftp://`, and `urn://` match-pattern methods that are not used by Titan's normal HTTPS runtime
