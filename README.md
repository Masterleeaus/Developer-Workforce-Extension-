![Titan Developer Workforce Extension — BROWSER EXTENSION · ENGINEERING WORKFORCE](docs/images/developer-workforce-banner.svg)

<div align="center">

# Titan Developer Workforce Extension

**A browser extension evolving Titan Code 3 into a governed 15-slot AI engineering workforce.**

</div>

## Product architecture and engineering highlights

A browser-based engineering workforce that extends Titan Code 3 with coordinated chat workers, supervisors, Codex builders, and a deterministic orchestrator.

- **Architecture:** The runtime separates composable agent profiles from running workers; Titan assigns work, bounds tools and authority, tracks state/evidence, and applies verification contracts.
- **Distinctive engineering:** The profile model carries expertise, architecture context, allowed capabilities, risk hints, and output/verification requirements—allowing a workforce to be composed without treating every profile as a live agent.

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

The extension includes browser-runtime tests and workforce module tests. The checked-in CI workflows are the authoritative map of supported checks; a manifest load alone is not evidence that the 15-slot workflow is complete.

### Fast local checks

From the repository root with Node.js 22 (the CI workflow uses Node 22):

```bash
node -e "JSON.parse(require('fs').readFileSync('hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/manifest.json','utf8')); console.log('manifest PASS')"
node hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/tests/package-integrity.test.js
node hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/titan-work-codex-pipeline-selftest.js
node hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/codex-sidepanel/titan-workforce/core-selftest.mjs
```

The full regression is defined in [developer-workforce-regression.yml](.github/workflows/developer-workforce-regression.yml); acceptance certification, packaging, and live extension smoke are separate workflows.

### Code map

- [`manifest.json`](hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/manifest.json) defines the MV3 entry points, permissions, side panel, and host access.
- [`background.js`](hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/background.js) owns the extension background runtime and dynamic entrypoint wiring.
- [`codex-sidepanel/titan-workforce/`](hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/codex-sidepanel/titan-workforce/) contains the 15-slot state, mission, review, verification, observability, and recovery modules.
- [`tests/`](hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/tests/) contains package-integrity, runtime-smoke, and acceptance checks.

The deterministic self-tests prove local contracts and state transitions. They do not prove provider-page compatibility, an authenticated live ChatGPT session, browser sleep/wake behavior, or release readiness; use the relevant workflow evidence before making those claims.

Start with:

- [Agent instructions](AGENTS.md)
- [Workstreams](WORKSTREAMS.md)
- [Titan 5×5 architecture notes](hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/TITAN-5X5-README.md)
- [Acceptance evidence contract](hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/TITAN-ACCEPTANCE-EVIDENCE.md)

## Architecture

<p align="center">
  <img src="docs/images/developer-workforce-architecture.svg" alt="Developer Workforce Extension flow from MV3 manifest and background runtime through mission context, 15-slot workforce, capability controls, verification, observability, and recovery" width="100%" />
</p>

The graphic is a source-backed map of the extension runtime: composable profiles feed runtime workers, the control plane bounds authority, and verification/evidence remain explicit.

## Architecture and safety

The implementation is organized around four work packages: profiles and dynamic casting, Chat squads, the Work/Codex pipeline, and core integration. Branch discipline, busy-safe scheduling, fail-closed authority, idempotency, actor/correlation/evidence lineage, and verification expectations are defined in `AGENTS.md`.

## Portfolio status

**Retain as an active supporting project.** This is separate from the Titan Zero business application: it is the development workforce used to help build and verify that system.

## Banner

A checked-in project-specific banner is displayed above.

