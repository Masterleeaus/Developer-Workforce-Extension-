# Titan 5×5 Supervisor v3.0.34

The Chrome extension itself is the supervisor. There is no sixth supervisor conversation/tab.

## Cadence
Five ChatGPT/Codex worker tabs are assigned W1–W5. Ordinary completed passes receive `NEXT`.
Reviews are staggered on a base-5 cadence:
- W1: completions 1, 6, 11...
- W2: completions 2, 7, 12...
- W3: completions 3, 8, 13...
- W4: completions 4, 9, 14...
- W5: completions 5, 10, 15...

This yields one deep review per global pass when workers progress at a similar rate.

## Internal review boundary
`titan-5x5-supervisor.js` exposes `window.Titan5x5Review.register(fn)`.
The native Codex/Automation layer should register a provider that accepts a compact review job and returns only the next worker instruction.

Until a provider is registered, a due review is queued/paused and emits `titan5x5:review-request`.
An integration may return a result through `titan5x5:review-result`.

This deliberately fails closed: it will not create a hidden or visible supervisor chat.

## First-pass scope
- five worker tabs
- persistent pass counters
- deterministic NEXT fast path
- staggered fifth-pass review
- serialized review queue
- compact transcript handoff
- internal review adapter
- no sixth supervisor tab

Next integration target: bind the adapter to the extension's native Codex/Automation execution API.


## v3.0.34
Mapped the native Codex app-server lifecycle and added the stable `installTitan5x5NativeCodex()` integration boundary. Fifth-pass reviews now require a native review provider; ordinary passes remain deterministic.


## v3.0.34
Added Titan Mission Control: persistent mission contracts for W1–W5, acceptance criteria, repo/branch constraints, status, and immediate escalation for blockers/failures/completion claims.


## v3.0.34
Added GitHub Truth v0.1. Completion claims now trigger authoritative verification and cannot directly mark a mission verified. Definition of Done requires commit, passing CI, merge, and presence on main.


## v3.0.34
Added Titan Context + Architecture v0.1: global invariants and locally selected mission-relevant subsystem context are injected only into deep reviews and escalations.


## v3.0.34
Added Repository Context v0.1: provider-backed real file/test/symbol/dependency impact slices, queried only at reviews and escalations with strict context caps.


## v3.0.34
Added Runtime Verification v0.1. GitHub success now transitions to runtime verification; final verified state requires deployment/browser/console/network/acceptance evidence (and server checks when applicable).


## v3.0.34
Hardening/convergence: tick serialization, state migration, tab-loss recovery, duplicate-review prevention, review timeout/retry, worker health, and fail-closed stalled-review handling.


## v3.0.34
Added Native Service Registry/auto-binding and a conservative built-in Chrome debugger runtime adapter. Cockpit now displays Codex/GitHub/Repository/Runtime binding status.


## v3.0.34
Added stock native adapter module and documented verified Codex app-server, Git service, workspace and GitHub/PR seams. Adapter remains dependency-injected to avoid brittle imports of hashed bundle exports.


## v3.0.34
Added deterministic in-extension 5×5 self-test and verified two complete scheduling cycles: each worker receives 2 reviews and 8 NEXT continuations across 10 completions.


## v3.0.34
Added live smoke-test diagnostics for five worker tabs, prompt/send/generation surfaces, Chrome permissions, and native C/G/R/V adapter readiness.


## v3.0.34
Installation/preflight hardening: stale Web Store computed hashes removed, module/API startup checks added, and deterministic cadence self-test runs as part of preflight.


## v3.0.34
Added explicit Arm/Disarm/E-STOP safety gate. Automation cannot start until preflight, 5/5 worker readiness and native Codex review readiness pass; tab loss automatically disarms.


## v3.0.34
Added zero-token worker coordination: mission overlap/collision detection, deterministic yielding, coordination-wait state, automatic release, and cockpit conflict count.


## v3.0.34
Added concrete ownership leases for repository files/symbols with 30-minute TTL, automatic conflict waits, refresh/pruning, and release on verified/cleared missions.


## v3.0.34
Added priority mission queue and automatic worker recycling after verified completion, with lease release, bounded completion history, compatibility filtering and new-mission priming.


## v3.0.34
Added zero-token mission dependency DAGs (`dependsOn`), readiness-aware queue ordering, automatic prerequisite unlocking and ready/waiting queue visibility.


## v3.0.34
Added mission budgets and zero-token anti-loop detection: bounded passes/reviews/time, progress fingerprints, repeated-output detection, and automatic attention escalation instead of unlimited NEXT.


## v3.0.34
Added local priority dispatch/backpressure: spaced prompt sends, active-worker cap, review-first priority, backlog throttling and E-STOP cancellation of queued sends.


## v3.0.34
Added durable per-worker checkpoint compaction. Deep reviews now use last checkpoint + bounded recent delta, reducing repeated conversation context while preserving mission continuity.


## v3.0.34
Added zero-token team convergence after every complete five-worker checkpoint round, comparing compact state for overlap, ownership conflicts, attention states and newly unlocked dependent missions.


## v3.0.34
Added objective mission progress indicators from acceptance/Git/runtime/pass-budget evidence, surfaced per worker and retained in convergence checkpoints. No AI grading is used.


## v3.0.34
Added deterministic acceptance-evidence reconciliation. Unambiguous Git/runtime-backed criteria auto-resolve; ambiguous criteria remain open. Worker recycling now requires Git + runtime + all acceptance criteria.


## v3.0.34
Added semantic acceptance resolution inside existing deep reviews. Reviewers can return a compact machine-readable acceptance envelope backed by present evidence; metadata is applied locally and stripped before the worker receives its instruction.


## v3.0.34
Added bounded append-only supervisor audit log for automatic sends, reviews, mission lifecycle, verification, safety controls and convergence; exportable as compact JSON.


## v3.0.34
Added crash/restart reconciliation: persisted state restoration, forced disarm, worker-tab/message reconciliation, offline-advance review queuing and duplicate-NEXT prevention across Chrome/side-panel restarts.


## v3.0.34
Added persistent worker conversation identity locks. All autonomous sends verify the bound ChatGPT conversation URL/ID; navigation or tab reuse causes fail-closed disarm rather than prompting the wrong conversation.


## v3.0.34
Added deterministic prompt idempotency and a bounded send ledger. Duplicate NEXT/review/mission actions are suppressed across retries and persisted state.


## v3.0.34
Added explicit high-impact approval gates. Routine continuation stays autonomous; force-completion, ownership overrides and future verification/scope overrides require a recent matching approval and are fully audited.


## v3.0.34
Added mission policy profiles with local risk inference. Routine work retains 5-pass reviews; sensitive/production missions automatically tighten review cadence, budgets and server-verification requirements.


## v3.0.34
Added stagger-preserving review scheduler. Risk policies control eligibility while a round-robin slotter caps normal scheduled reviews to one per polling cycle; exceptions still escalate immediately.


## v3.0.34
Added adaptive worker utilization. Five slots remain available, while local pressure scoring temporarily reduces routine active concurrency to 4/3/2 and automatically ramps back to five as review/conflict/verification pressure clears.


## v3.0.34
Added fair adaptive-utilization rotation. Throttled NEXT slots now go to least-recently-advanced eligible workers, preventing W4/W5 starvation under sustained pressure.
