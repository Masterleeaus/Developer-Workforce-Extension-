# Developer Workforce Extension v4 installation & packaging policy

This repository's modified Chrome extension is intended to be loaded as an **unpacked developer extension** during Titan development and integration.

## Canonical identity

- Product: **Developer Workforce Extension**
- Manifest generation: Manifest V3
- Version source of truth: `manifest.json`
- Current architecture: 15-agent Titan engineering workforce
- Stock provenance: `codex/build-info.json` records the upstream OpenAI build SHA/flavor/channel used as the extension base.

The package workflow derives its artifact name from `manifest.json`; do not hard-code the extension version in CI.

## Stock extension key and update URL

The modified package currently retains the upstream stock extension `key` and Chrome Web Store `update_url`.

This is deliberate **compatibility mode** for development because the stock extension identity is intertwined with native messaging/AppServer compatibility and official extension-channel metadata.

Important boundaries:

1. The supported Titan deployment mode is **unpacked developer extension**, not a separately published/signed Chrome Web Store release.
2. Do not treat the retained stock key as ownership of the upstream extension identity.
3. Do not publish this modified package to the Chrome Web Store using the upstream identity.
4. If Titan later moves to a separately signed extension ID, native messaging allowed-origins/manifests and AppServer compatibility must be migrated and re-certified first.
5. The retained `update_url` must be re-evaluated before any packed/signed distribution path is enabled. The current packaging workflow produces a ZIP for manual developer loading; it does not produce a signed CRX/Web Store release.

## Package integrity

Run:

```bash
node hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/tests/package-integrity.test.js
```

The validator checks:

- canonical manifest identity/version
- stock build provenance
- manifest entrypoint/resource existence
- local HTML script/style/modulepreload references
- required dynamic service-worker entrypoints
- stale Web Store computed hashes
- package workflow version derivation
- bounded upstream dormant-reference allowlists

## Known upstream dormant references

The current upstream OpenAI stable build references the feature-gated files:

- `content-scripts/webmcp.js`
- `content-scripts/webmcp-bridge.js`

but does not ship them. Do **not** fabricate replacements. They remain a known upstream dormant seam until a future upstream build actually includes/enables them.

The browser-family registry also carries metadata paths for Chrome/Edge/Brave/Opera/Vivaldi icon assets that are absent in this extracted build. They are currently treated as upstream metadata-only references; if runtime code begins dereferencing them, they must be promoted to required package assets.

## Preflight vs diagnostics

- **Package integrity** checks static install/package correctness.
- **Preflight** checks extension/module/runtime capability health.
- **Diagnostics** checks live bindings, services and runtime behavior.

A release candidate should pass all three layers before use.
