# Titan single-tab task runner (Dots-era design)

## Operating model

Titan is the control surface around one selected ChatGPT conversation. Open the Chrome side panel from a GitHub tab, discover open ChatGPT conversations, and bind one `chatgpt.com/c/<conversation-id>` tab. Post the task in that conversation and start the runner.

The runner:

1. Checks the bound conversation on a configurable interval (1–1,440 minutes; default 10).
2. When it sees a new user task and the conversation is idle, asks for exactly ten ordered, verifiable subtasks in a strict JSON shape.
3. Validates the ten-item plan and sends one subtask prompt per interval.
4. Waits for the current assistant response before sending the next item. A busy conversation is never interrupted.
5. Records response status, result excerpts, checks, errors, and a bounded history in Titan state. A received model response is not treated as independent verification.

The single-tab runner is separate from the existing 15-slot workforce scheduler. It reuses the existing ChatGPT conversation service, state persistence, audit log, runtime owner, and Chrome alarm system; it does not create a second browser automation engine.

## Dots, Chat, Work, and Codex boundary

The runner sends prompts through the existing visible ChatGPT conversation adapter. It does not call an undocumented Dots, Work, or Codex API and cannot inspect Dot Activity or native background-task status. If the selected ChatGPT conversation has access to a Dot or another supported agent experience, prompts are delivered to that conversation; whether the agent delegates or continues in the background remains owned by ChatGPT.

The first version binds an open `chatgpt.com/c/<id>` browser tab. The side panel can be opened while GitHub is active, but the GitHub tab itself is not treated as the AI conversation and native Codex task pages are not bound. The task must be present in the selected ChatGPT conversation.

## Scheduling and recovery

Chrome alarms let Manifest V3 wake its service worker while Chrome is running. They do not wake a sleeping computer, and Chrome may deliver a missed alarm only after the browser/device resumes. Scheduling is therefore interval-based, not a hard real-time deadline. If the conversation is generating at an alarm, the runner backs off by one interval.

If a send returns an ambiguous failure, the runner pauses for review instead of risking a duplicate prompt. If the conversation tab disappears or its identity changes, it pauses and reports the lost binding. An invalid ten-item plan also pauses for review. Pause, rebind, and clear are user-controlled side-panel actions. Rebinding preserves the unfinished response batch in bounded history.

## Data flow

- Persisted data: bound conversation identity, interval, ten task titles/instructions/statuses, recent response excerpts, and bounded history in existing Titan local state.
- No new network service, API credential, Dots endpoint, GitHub mutation, or telemetry is introduced.
- One conversation is bound at a time. Existing mission workers and lifecycle remain available and unmodified by the single-tab scheduler.
