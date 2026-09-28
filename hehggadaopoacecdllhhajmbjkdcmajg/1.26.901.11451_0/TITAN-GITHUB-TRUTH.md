# Titan GitHub Truth v0.1

Worker prose is not completion evidence.

A stock GitHub integration should register:
`window.installTitan5x5GitHubTruth(async ({workerIndex, mission}) => truth)`

Truth result:
- `branchExists`
- `commitExists`
- `prExists`
- `ciPassed`
- `merged`
- `presentOnMain`
- optional `evidence`
- optional `url`

Current Definition of Done requires:
1. commit exists
2. CI passed
3. merged
4. change present on main

A completion claim automatically requests verification. If no provider is installed, Titan emits
`titan5x5:github-truth-request` and leaves the mission in verification state.

External integrations may answer with `titan5x5:github-truth-result`.

Mission states:
`assigned → working → verification → verified`
or
`verification → verification-failed`

This layer intentionally does not infer truth from the browser conversation.
