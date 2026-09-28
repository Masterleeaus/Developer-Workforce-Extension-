# Extension Runtime & Message-Handshake Smoke Tests

This suite covers the underlying Chrome extension runtime separately from the 15-agent workforce tests.

## Run

From the repository root:

```bash
node hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/tests/extension-runtime-smoke.test.js
```

No browser, credentials, network access or external packages are required.

## Covered contracts

The smoke test validates:

- Manifest V3 service-worker, sidepanel and declared content-script entrypoints.
- Required Chrome permissions used by runtime code.
- Local script/style/modulepreload references in the local sidepanel, Work sidepanel and microphone permission page.
- Service-worker message contracts for extension status, sidepanel open, installer and Work auth state.
- Dynamic Codex and foreign-frame-monitor entrypoints.
- ChatGPT website request/response message names.
- Codex agent-cursor runtime handshake.
- Work sidepanel iframe, auth revalidation, browser-side-chat context and storage seams.
- Microphone/camera permission handoff.
- Service-worker startup/update/session/native-host lifecycle contracts.
- Titan native adapter and expanded preflight bootstrap.
- Explicit failure strings for tab-context and native-host/AppServer failures.

## Scope

This test intentionally avoids duplicating workforce unit tests. It checks that the extension shell required by the workforce is still present and mutually compatible.

The current upstream OpenAI build references WebMCP dynamic content scripts behind the `codex-app-webmcp` feature gate but does not ship those files. They are therefore not required by this smoke test. If a future upstream package ships/enables them, package-integrity validation can promote them to required entrypoints.

## CI

`.github/workflows/extension-runtime-smoke.yml` runs the suite whenever extension runtime/bootstrap files change.

A renamed stable message contract, missing required entrypoint, missing local bootstrap asset, or removed lifecycle seam fails CI rather than silently reaching users.
