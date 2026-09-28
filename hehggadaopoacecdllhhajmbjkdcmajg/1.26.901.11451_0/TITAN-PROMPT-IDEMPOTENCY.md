# Titan Prompt Idempotency v0.1

Every autonomous prompt now receives a deterministic action key derived from:
- worker
- action kind
- mission
- pass/review
- bounded prompt content

Before dispatch Titan checks:
1. successfully sent ledger entries
2. currently pending dispatch entries

Duplicates are suppressed and audited.

The bounded send ledger retains the latest 500 actions.

Applies to:
- NEXT
- deep-review instructions
- mission assignments
- other guarded worker prompts

This complements restart reconciliation and conversation identity locking: correct destination + exactly-once intent.
