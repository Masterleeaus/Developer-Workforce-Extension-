<div align="center">

# Titan Developer Workforce Extension

**A browser extension evolving Titan Code 3 into a governed 15-slot AI engineering workforce.**

</div>

> **Status: active migration and implementation workspace.** The repository contains the extension seed, workforce runtime modules, tests, and architecture documents. The target is documented; verify the current acceptance suite before treating the complete 15-slot workflow as released.

## Target workforce

- 10 Chat workers in two squads of five
- 2 Work supervisors
- 2 Codex builders
- 1 Codex orchestrator
- Approximately 50 composable specialist profiles

The profile catalog describes roles and execution constraints. Profiles are not additional running agents. Titan remains the deterministic control plane for assignment, authority, state, evidence, and verification.

## Install for development

1. Clone the repository.
2. Open Chrome or another Chromium-based browser and visit `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extension root containing `manifest.json`.
5. Reload the extension after changing source files.

The repository is under active migration; use a clean test browser profile and review the extension permissions before installing it in a daily-use profile.

## Development and verification

The extension includes browser-runtime tests and workforce module tests. Inspect the checked-in test scripts and workstream docs for the current authoritative commands; do not infer full acceptance from the manifest loading successfully.

Start with:

- [Agent instructions](AGENTS.md)
- [Workstreams](WORKSTREAMS.md)
- [Titan Workforce README](hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/TITAN-5X5-README.md)

The seed package is included under an opaque upstream extension ID and version path. It is retained as provenance material; rename or replace that path only through a reviewed migration that preserves extension packaging and source history.

## Architecture and safety

The implementation is organized around four work packages: profiles and dynamic casting, Chat squads, the Work/Codex pipeline, and core integration. Branch discipline, busy-safe scheduling, fail-closed authority, idempotency, actor/correlation/evidence lineage, and verification expectations are defined in `AGENTS.md`.

## Portfolio status

**Retain as an active supporting project.** This is separate from the Titan Zero business application: it is the development workforce used to help build and verify that system.

## Banner

The extension already contains a project icon, but no verified wide banner. The typographic title is used until a suitable banner is added.
