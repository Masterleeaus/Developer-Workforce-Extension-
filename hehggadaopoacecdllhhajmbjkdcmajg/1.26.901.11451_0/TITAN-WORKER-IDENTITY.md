# Titan Worker Conversation Identity Lock v0.1

Worker slots are no longer trusted by Chrome tab ID alone.

When W1–W5 is bound, Titan stores the ChatGPT conversation identity derived from its `/c/<conversation-id>` URL.

Before:
- inspection
- NEXT
- deep-review instruction
- new mission assignment
- restart reconciliation

Titan verifies that the current tab still represents the originally bound conversation.

On mismatch:
- no prompt is sent
- worker enters `identity-mismatch`
- active mission enters attention
- supervisor disarms
- audit event is recorded

Diagnostics now requires identity match for a worker to count as ready.

This protects against tab navigation/reuse accidentally sending autonomous instructions into the wrong conversation.
