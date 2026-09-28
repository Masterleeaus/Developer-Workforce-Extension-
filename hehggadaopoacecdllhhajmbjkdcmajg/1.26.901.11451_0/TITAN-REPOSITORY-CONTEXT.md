# Titan Repository Context v0.1

Mission reviews can now consume a real repository impact slice.

Register a provider:

`window.installTitan5x5RepositoryContext(async ({mission, transcript, limit}) => result)`

Suggested result:
- `files`: relevant implementation files
- `tests`: relevant tests
- `symbols`: relevant classes/functions/capabilities
- `edges`: dependency/impact edges
- `summary`: compact optional explanation

The supervisor requests repository context only when:
- a worker reaches its staggered fifth-pass review
- a blocker/failure is detected
- a completion claim is detected

Normal `NEXT` passes do not query repository context.

Hard caps keep the review payload compact:
12 files, 8 tests, 12 symbols, 12 edges.

The provider can be backed by the stock Codex workspace, GitHub integration, or a future port of Titan Code's repository intelligence.
