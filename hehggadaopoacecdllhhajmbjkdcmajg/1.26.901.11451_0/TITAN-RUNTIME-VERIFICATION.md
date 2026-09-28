# Titan Runtime Verification v0.1

GitHub success and runtime success are separate gates.

Register:
`window.installTitan5x5RuntimeVerification(async ({mission, requirements}) => result)`

Runtime result supports:
- `deployed`
- `browserPassed`
- `consoleClean`
- `networkPassed`
- `acceptancePassed`
- optional `serverPassed`
- `environment`
- `evidence`

The provider can use the stock Chrome debugger/browser control plus terminal/VPS/DirectAdmin adapters.

## Final Definition of Done

Git:
- commit exists
- CI passes
- merged
- present on main

Runtime:
- deployed
- browser acceptance passes
- console clean
- network/API checks pass
- mission acceptance passes
- server checks pass when applicable
- evidence captured

Only when both gates pass does the mission become `verified`.

A GitHub-successful mission transitions to `runtime-verification`, not `verified`.
