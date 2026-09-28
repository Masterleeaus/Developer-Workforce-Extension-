# Titan Context + Architecture v0.1

The supervisor now injects compact Titan-specific architectural context only for deep reviews and exception escalations.

## Global invariants
- fail-closed company tenancy
- reuse existing engines/gateways/state
- preserve Authority/Execution mutation path
- preserve idempotency, correlation, actor and evidence
- no duplicate source of truth
- one active branch/worktree per mission
- runtime/test evidence required

## Architecture map
Initial subsystem vocabulary:
Interaction, Decision, Workforce, Field/Titan Go, Customer, Owner/Titan Zero, DirectAdmin, CRM, Commerce, Runtime/VPS.

## Context selection
Mission title, goal, repository, constraints, acceptance criteria and recent transcript are tokenized locally.
Only the top four matching subsystem summaries are injected.

Normal `NEXT` passes receive none of this context.

This is intentionally a compact first port. Future passes can replace the static map with repository-derived architecture and dependency graphs.
