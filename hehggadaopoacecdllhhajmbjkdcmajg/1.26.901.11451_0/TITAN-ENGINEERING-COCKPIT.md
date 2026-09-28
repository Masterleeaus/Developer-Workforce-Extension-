# Titan v4 Engineering Cockpit

Issue #21 upgrades the Developer Workforce sidepanel into an operable remote control surface for the background-owned v4 runtime.

## Runtime ownership

The cockpit is a client only.

- Canonical state remains in the MV3 background runtime.
- The sidepanel never creates a controller, scheduler, Work supervisor, Codex builder or second timer.
- All mutations go through `TITAN_WORKFORCE_RUNTIME_COMMAND`.

## Conversation binding

The cockpit can discover authenticated ChatGPT conversation tabs and bind them to:
- A1–A5
- B1–B5
- SUPERVISOR_A
- SUPERVISOR_B

Builders and the Orchestrator use native/Codex service readiness rather than Chat conversation binding.

Binding is identity-locked. Rebinding to a different conversation fails closed until the existing binding is explicitly reconciled by runtime policy.

## Per-agent visibility

Chat workers show:
- mission and profiles
- cycle
- current pass / completed passes
- next gate
- scheduler state
- bound conversation

Work supervisors show:
- mission/profiles
- pending review state
- source worker/cycle
- bound conversation

Codex builders show, when available:
- phase
- branch
- PR
- CI
- implementation packet

The Orchestrator shows the current phase and decision when present.

## Controls

Global:
- arm/disarm
- E-STOP
- pause all / resume all

Squad:
- pause/resume Squad A
- pause/resume Squad B

Agent:
- pause/resume
- quarantine/unquarantine

Unquarantine is an explicit user-approved action. Paused/quarantined agents are enforced at Chat, Work, Builder and Orchestrator execution seams; they are not cosmetic UI flags.

## Diagnostics

The background diagnostics projection reports:
- 15-agent topology
- native/service readiness
- Builder/Orchestrator Codex readiness
- mission/profile assignments
- Chat scheduler cycle/pass/gate details
- Work review state
- Builder/Orchestrator state
- verification backlog
- merge pressure
- lifecycle state
- usage governor state

The cockpit provides separate **Diagnostics** and **Preflight** controls. Extension-wide preflight remains owned by the dedicated preflight/runtime diagnostics workstream rather than duplicated here.

## Background commands added

- `discoverConversations`
- `bindAgentConversation`
- `pauseSquad`
- `resumeSquad`
- `pauseAll`
- `resumeAll`
- `quarantineAgent`
- `unquarantineAgent`
- `diagnostics`

Existing commands remain backward compatible.

## Verification

`cockpit-diagnostics.test.mjs` validates the diagnostics projection, conversation discovery, binding/control command contract, and ensures the v4 sidepanel has no dependency on legacy `Titan5x5` globals.
