# Titan 5×5 Live Smoke Test

## Before Start
1. Load the unpacked extension in Chrome developer mode.
2. Open five authenticated ChatGPT/Codex conversations.
3. Open the Titan side panel.
4. Auto-discover or bind W1–W5.
5. Press **Diagnostics**.

Diagnostics verifies:
- all five tab IDs still exist
- each worker page exposes a usable prompt composer
- scripting/tabs permissions
- native Codex/GitHub/Repository/Runtime adapter status
- whether fifth-pass review is actually ready

`window.__titan5x5Diagnostics` contains the detailed report.

## Safe live test
Start with disposable/test conversations. The supervisor will send `NEXT` on normal completions.
Do not use production-critical conversations until Diagnostics reports the expected bindings.

## Expected first milestone
Five workers ready + Codex review bound = supervisor cadence can be tested live.
GitHub/Repository bindings are required for authoritative mission completion, not merely tab continuation.
