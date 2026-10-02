# ChatGPT extension single-tab task runner

## Operating model

The runner uses the ChatGPT conversation inside the Chrome side panel. Open that panel while the browser is on the GitHub tab you want the conversation associated with, bind the active tab, then choose **Use ChatGPT** and enter the task in the extension's conversation.

Titan checks the selected conversation on a configurable interval (1–1,440 minutes; default 10). When it sees a new user task and ChatGPT is idle, it asks for exactly ten ordered, verifiable subtasks in a strict JSON shape. It validates the plan, then sends one subtask prompt per interval, waiting for the previous response before continuing. A busy conversation is never interrupted.

The bound browser tab ID is the conversation identity. Changing the active tab causes the runner to pause on identity mismatch. Keep the ChatGPT extension side panel open while the runner is active so the background service worker can request a probe or send a prompt through the side-panel bridge.

The runner reuses the existing conversation service functions, Titan state persistence, audit log, runtime owner, and Chrome alarm system. It does not create a second browser automation engine and is separate from the existing 15-slot workforce scheduler.

## Dots, Chat, Work, and Codex boundary

Prompts are sent through the visible ChatGPT extension conversation. The runner does not call an undocumented Dots, Work, or Codex API and cannot inspect Dot Activity or native task status. If the selected ChatGPT conversation offers an agent experience, delegation and background continuation remain owned by ChatGPT.

This first version controls the ChatGPT extension's own side-panel conversation while it is open. It does not bind a separate `chatgpt.com/c/<id>` page or directly operate a native Codex/Work task page.

## Scheduling and recovery

Chrome alarms wake the Manifest V3 service worker while Chrome is running. They do not wake a sleeping computer. If the conversation is generating at an alarm, the runner defers by one interval. If the side panel is closed, its bridge cannot answer until the panel is open again.

Ambiguous sends pause for review instead of risking a duplicate prompt. A lost tab binding or invalid ten-item plan also pauses. Pause, rebind, and clear remain user-controlled. Rebinding preserves an unfinished response batch in bounded history. Received model responses are recorded as responses, not independent verification.

## Data flow

- Titan persists the bound active-tab identity, interval, ten subtask titles/instructions/statuses, response excerpts, errors, and bounded history in existing local state.
- No new network service, API credential, Dots endpoint, GitHub mutation, or telemetry is introduced.
