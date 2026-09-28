# Titan Background Autonomous Runtime

The Developer Workforce v4 canonical runtime is owned by the Manifest V3 background service worker, not by the sidepanel document.

## Ownership

`manifest.json` starts `titan-background.js` as a module service worker.

The wrapper:

1. starts the stock OpenAI `background.js` service-worker bundle;
2. loads the WP1/WP2/WP3 shared runtime packages onto `globalThis`;
3. starts `codex-sidepanel/titan-workforce/background-runtime.js`.

The canonical v4 state remains `titanDeveloperWorkforceV4` in `chrome.storage.local`.

## MV3 scheduling

The background owner installs one alarm:

`titan-workforce-runtime-tick`

It wakes approximately once per minute and calls the busy-safe WP2 scheduler. Five-minute gates remain owned by scheduler timestamps; the one-minute alarm is only a wake/check cadence and cannot make a pass eligible early.

The service worker also rehydrates the runtime on:

- service-worker load
- Chrome startup
- extension install/update
- runtime command messages

`chrome.runtime.onSuspend` persists current state before suspension when Chrome provides the callback opportunity.

## Exactly-once protection

The background owner serializes concurrent ticks with one `tickPromise`.

The existing scheduler snapshot and send ledger are persisted through `chrome.storage.local`. Rehydration restores the scheduler/action keys so an already-sent pass is not sent again merely because the service worker restarted.

Durability hardening beyond the current ledger boundary remains coordinated with issue #17.

## Sidepanel boundary

`codex-sidepanel/index.html` no longer loads `titan-workforce/bootstrap.js`.

Instead it loads `titan-workforce/sidepanel-client.js`, which:

- requests canonical snapshots from the background runtime;
- renders the 15-agent cockpit;
- sends arm/disarm/E-STOP commands through `chrome.runtime.sendMessage`;
- exposes a compatibility facade at `window.TitanDeveloperWorkforce` for current preflight consumers;
- does not create a controller, scheduler, live-chat timer, or second state owner.

Closing or reloading the sidepanel therefore cannot stop the autonomous runtime.

## Background command contract

Message type:

`TITAN_WORKFORCE_RUNTIME_COMMAND`

Supported actions include:

- `snapshot`
- `arm`
- `disarm`
- `emergencyStop`
- `clearEmergencyStop`
- `markReconciled`
- `missionUpsert`
- `bindConversation`
- `startCycle`
- `tick`
- `pauseAgent`
- `resumeAgent`

State notifications use:

`TITAN_WORKFORCE_RUNTIME_STATE`

## Long-running Work/Codex operations

The canonical controller, scheduler, Work routing and Codex fallback services are created in the service worker. Bound-conversation and GitHub/repository fallback state survives worker restarts because mission, agent and scheduler state are persisted.

Work/Codex execution durability and repair routing remain further hardened by the dedicated pipeline/durability missions (#16/#17); this runtime change removes the sidepanel document as their lifecycle owner.

## Verification

Run:

```bash
node hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/codex-sidepanel/titan-workforce/background-runtime.test.mjs
```

The test verifies:

- sidepanel-independent ticking;
- one runtime instance per service-worker lifetime;
- one named runtime alarm;
- concurrent tick serialization;
- exactly-once action-key behavior;
- persisted state across simulated service-worker restart;
- remote cockpit control commands;
- manifest/background ownership wiring.
