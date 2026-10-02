# Titan Developer Workforce Extension package

**Chrome/Chromium extension seed package and Titan workforce integration.**

## Install locally

1. Open `chrome://extensions/` in Chrome or a compatible Chromium browser.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select this directory, the one that contains `manifest.json`.
5. Review the requested host permissions and test in a dedicated browser profile.

Do not load the repository root; the manifest is nested in this package directory.

## Single-tab task runner (4.1.0)

The Chrome side panel can be opened while a GitHub tab is active. Use **Discover conversations**, bind one open `chatgpt.com/c/<id>` tab, and start the runner after posting a task in that conversation. Titan asks for exactly ten ordered subtasks, then sends one subtask per configured interval after the prior response completes. The minimum interval is one minute. The runner pauses on ambiguous sends or a lost conversation binding. It uses MV3 alarms; Chrome can wake the extension worker while running, but alarms do not wake a sleeping computer. See the repository-root `SINGLE-TAB-DOTS-RUNNER.md` for the operating boundaries and data flow.

The runner controls the selected visible ChatGPT conversation through the existing adapter. It does not call a Dots, Work, or Codex API. Native Work/Codex task pages are not bound directly.

## Package provenance

This directory is retained from the Titan Code 3 v3.0.34 extension seed and identifies its original source package/version. The root repository contains the migration workstreams and added Titan workforce code. Preserve the original package identity and manifest provenance when producing later installable bundles.

## Workforce integration

Titan 5×5 supervisor and extension runtime notes are in the root repository's `TITAN-5X5-README.md`, `TITAN-EXTENSION-RUNTIME-SMOKE.md`, and `TITAN-INSTALL-PREFLIGHT.md`. The evolving Titan workforce implementation and tests are in `codex-sidepanel/titan-workforce/`.

## Security

Inspect `manifest.json` permissions before install. Use a clean test profile, do not include personal browser data in test cases, and confirm the final bundle contains no developer credentials or temporary build artifacts.
