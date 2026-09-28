# Verified stock extension seams — v3.0.10

Deep scan confirms:

## Codex
The app-server request scheduler has named methods including:
- thread/start
- thread/resume
- thread/goal/set
- turn/start
- turn/steer
- turn/interrupt

It observes:
- thread/started
- turn/started
- turn/completed
- agent-message deltas

## Git
`git-api-*` routes Git operations through a named `git` service:
`request({ method, params, signal })`.

The workspace repository layer also queries this Git service.

## GitHub / PR
The PR query layer supports GitHub connector and GitHub CLI sources, including PR detail/diff/media.

## Integration policy
Titan does not import hashed/minified exports. `titan-stock-native-adapters.js` accepts stable host capabilities and publishes them into `TitanNativeServices`.

This is the adapter seam to patch when upstream extension builds change, rather than rewriting Titan Supervisor.
