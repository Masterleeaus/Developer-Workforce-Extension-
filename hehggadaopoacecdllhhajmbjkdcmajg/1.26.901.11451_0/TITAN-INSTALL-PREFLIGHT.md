# Titan v3.0.13 installation/preflight

This build is intended to be loaded as an **unpacked developer extension**.

Changes:
- removes stale Chrome Web Store `_metadata/computed_hashes.json` from the modified package
- adds startup preflight checks for Chrome APIs and Titan modules
- runs the deterministic 5×5 cadence self-test at startup
- exposes `window.__titanPreflight`
- adds a **Preflight** cockpit button

Preflight is separate from live Diagnostics:
- Preflight = extension/module/package health
- Diagnostics = five authenticated worker tabs + native service readiness
