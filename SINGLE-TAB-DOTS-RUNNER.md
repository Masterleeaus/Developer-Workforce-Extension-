# ChatGPT extension single-tab task runner

## Operating model

The runner uses the ChatGPT conversation inside the Chrome side panel. Open that panel while the browser is on the GitHub tab you want the conversation associated with, bind the active tab, then choose **Use ChatGPT** and enter the task in the extension's conversation.

Titan checks the selected conversation on a configurable interval (1–1,440 minutes; default 10). When it sees a new user task, it asks for exactly ten ordered, verifiable subtasks in a strict JSON shape and waits for that plan to finish. It validates the plan, then attempts one subtask prompt per interval without waiting for previous responses. Each UI-accepted prompt may queue while ChatGPT is generating; the runner cannot force ChatGPT to accept a prompt when the UI disables or rejects submission.

The bound browser tab ID is the conversation identity. Changing the active tab causes the runner to pause on identity mismatch. Keep the ChatGPT extension side panel open while the runner is active so the background service worker can request a probe or send a prompt through the side-panel bridge.

The runner reuses the existing conversation service functions, Titan state persistence, audit log, runtime owner, and Chrome alarm system. It does not create a second browser automation engine and is separate from the existing 15-slot workforce scheduler.

## Dots, Chat, Work, and Codex boundary

Prompts are sent through the visible ChatGPT extension conversation. The runner does not call an undocumented Dots, Work, or Codex API and cannot inspect Dot Activity or native task status. If the selected ChatGPT conversation offers an agent experience, delegation and background continuation remain owned by ChatGPT.

This first version controls the ChatGPT extension's own side-panel conversation while it is open. It does not bind a separate `chatgpt.com/c/<id>` page or directly operate a native Codex/Work task page.

## Scheduling and recovery

Chrome alarms wake the Manifest V3 service worker while Chrome is running. They do not wake the ChatGPT model or a sleeping computer, and Chrome may delay an alarm. While waiting for the ten-item plan, the runner checks again at its interval. After the plan is ready, it attempts each subtask at the configured cadence even if generation is active. The side panel must remain open for the bridge to answer.

If a subtask send is unconfirmed, the runner retries that same subtask every five minutes. After five failed retry passes, it parks the runner, creates a machine-readable diagnostic report, and tries to discard the bound tab from memory. Chrome refuses to discard an active tab, so in that case the runner sleeps while the report records why the tab could not be discarded.

Diagnostics include retry timestamps and error codes, task ID, tab/window identity, composer and send-control availability, generation state, message counts, page route class, browser/extension versions, and rule-based classification with suggested checks. They omit message text, task instructions, and response contents. The report stays in local extension state for inspection in the side panel. UI acceptance is recorded separately from model completion; neither is treated as independent verification.

## Data flow

- Titan persists the bound tab, schedule/retry state, task statuses, sanitized probe summaries, bounded attempt history, and the diagnostic report in existing local state.
- No new network service, API credential, Dots endpoint, GitHub mutation, or telemetry is introduced.

