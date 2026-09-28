(function () {
  "use strict";

  const api = typeof require === "function"
    ? require("./titan-work-codex-pipeline.js")
    : globalThis.TitanWorkCodexPipeline;

  function ok(condition, message) {
    if (!condition) throw new Error("WP3 self-test failed: " + message);
  }

  function expectThrow(fn, message) {
    let threw = false;
    try { fn(); } catch (_) { threw = true; }
    ok(threw, message);
  }

  function mission() {
    return {
      id: "mission-1",
      title: "Implement bounded pipeline",
      repository: "example/repo",
      constraints: ["preserve architecture"],
      acceptance_criteria: [{ id: "a1", text: "tests pass" }],
      runtime_requirements: ["browser", "network"]
    };
  }

  function readyReview(passes, worker) {
    return api.createCycleReview({
      mission: mission(),
      worker: worker || "A1",
      squad: "A",
      cycle: 1,
      passes_completed: passes,
      approved_findings: ["finding"],
      next_decision: "READY_FOR_CODEX",
      evidence_quality: { score: "high" }
    }, { clock: { now: () => 1000 } });
  }

  const continue5 = api.createCycleReview({
    mission: mission(),
    worker: "A1",
    squad: "A",
    cycle: 1,
    passes_completed: 5,
    next_decision: "CONTINUE_5"
  });
  ok(api.nextResearchEpoch(continue5).target_passes === 10, "5-pass review must route to 10 passes");

  const continue10 = api.createCycleReview({
    mission: mission(),
    worker: "A1",
    squad: "A",
    cycle: 1,
    passes_completed: 10,
    next_decision: "CONTINUE_5"
  });
  ok(api.nextResearchEpoch(continue10).target_passes === 15, "10-pass review must route to 15 passes");

  expectThrow(() => api.createCycleReview({
    mission: mission(),
    worker: "A1",
    squad: "A",
    cycle: 1,
    passes_completed: 15,
    next_decision: "CONTINUE_5"
  }), "15 passes must require an explicit decision");

  const review = readyReview(15);
  const delta = api.compileApprovedImplementationDelta({
    mission: mission(),
    cycle_reviews: [review],
    validated_findings: ["use isolated module"],
    required_changes: ["add contracts"],
    scope_paths: ["src/pipeline"],
    expected_files: ["src/pipeline/index.js"],
    tests: [{ name: "unit", required: true }],
    runtime_verification: ["browser"],
    rejected_approaches: ["duplicate Mission Control"]
  });
  ok(delta.source_cycle_reviews.length === 1, "delta must preserve CycleReview provenance");

  expectThrow(() => api.compileApprovedImplementationDelta({
    mission: mission(),
    cycle_reviews: [continue5],
    scope_paths: ["src/pipeline"]
  }), "non-approved review must not compile to delta");

  const packet = api.assignBuilder(delta, {}, {
    "builder-a": { workload: 2, repository: "example/repo" },
    "builder-b": { workload: 0, repository: "example/repo" }
  });
  ok(packet.builder_slot === "builder-b", "least-loaded compatible builder should be selected");

  const conflictPacket = api.createCodexImplementationPacket(delta, { builder_slot: "builder-a" });
  const chosen = api.chooseBuilder(conflictPacket, {
    "builder-a": { workload: 0, repository: "example/repo", owned_paths: ["src/pipeline"] },
    "builder-b": { workload: 1, repository: "example/repo", owned_paths: [] }
  });
  ok(chosen === "builder-b", "conflicting ownership must be avoided");

  const builderResult = api.createBuilderResult({
    packet,
    files_changed: ["src/pipeline/index.js"],
    diff: "diff --git",
    tests: [{ name: "unit", passed: true }],
    commit: { sha: "abc" },
    branch: { name: "agent-3" },
    pr: { number: 1 },
    ci: { passed: true }
  });
  ok(builderResult.provenance.some(p => p && p.kind === "codex-packet"), "BuilderResult must preserve packet provenance");

  expectThrow(() => api.createBuilderResult({
    packet,
    files_changed: ["outside/file.js"]
  }), "builder scope expansion must fail closed");

  const baseBundle = {
    mission: mission(),
    approved_deltas: [delta],
    builder_results: [builderResult],
    actual_git_diff: "diff --git",
    tests: [{ name: "unit", passed: true }],
    github_truth: { commitExists: true, ciPassed: true, merged: true, presentOnMain: true },
    runtime_evidence: { deployed: true, browserPassed: true, consoleClean: true, networkPassed: true, acceptancePassed: true },
    acceptance_evidence: { passed: true }
  };

  const complete = api.decideOrchestrator(api.createOrchestratorBundle(baseBundle));
  ok(complete.state === "COMPLETE", "all objective gates should allow COMPLETE");

  const verify = api.decideOrchestrator(api.createOrchestratorBundle(Object.assign({}, baseBundle, {
    github_truth: { commitExists: true, ciPassed: true, merged: false, presentOnMain: false }
  })));
  ok(verify.state === "VERIFY", "missing Git truth must route to VERIFY");

  const repair = api.decideOrchestrator(api.createOrchestratorBundle(Object.assign({}, baseBundle, {
    tests: [{ name: "unit", passed: false }]
  })));
  ok(repair.state === "REPAIR", "failed tests must route to REPAIR");

  const research = api.decideOrchestrator(api.createOrchestratorBundle(baseBundle), {
    research_required: true,
    squad: "A",
    research_request: { question: "confirm invariant" }
  });
  ok(research.state === "RESEARCH", "research hint must route to RESEARCH");

  const blockedResult = api.createBuilderResult({
    packet,
    files_changed: [],
    blockers: ["permission denied"]
  });
  const blocked = api.decideOrchestrator(api.createOrchestratorBundle(Object.assign({}, baseBundle, {
    builder_results: [blockedResult]
  })));
  ok(blocked.state === "BLOCKED", "builder blocker must route to BLOCKED");

  ok(api.transition(api.PIPELINE_STATES.RESEARCH, api.PIPELINE_STATES.SUPERVISOR_REVIEW) === api.PIPELINE_STATES.SUPERVISOR_REVIEW, "valid transition should pass");
  expectThrow(() => api.transition(api.PIPELINE_STATES.RESEARCH, api.PIPELINE_STATES.COMPLETE), "research must not jump directly to COMPLETE");

  const chain = api.buildProvenanceChain({
    mission: mission(),
    cycle_reviews: [review],
    approved_deltas: [delta],
    codex_packets: [packet],
    builder_results: [builderResult],
    orchestrator_decisions: [complete],
    verification: complete.gates
  });
  ok(chain.mission && chain.approved_deltas.length === 1 && chain.builder_results.length === 1, "end-to-end provenance chain must be retained");

  const result = {
    passed: true,
    version: api.version,
    checks: [
      "5/10/15-pass epoch routing",
      "15-pass explicit-decision enforcement",
      "CycleReview -> ApprovedImplementationDelta provenance",
      "delta approval validation",
      "Builder A/B workload routing",
      "scope/ownership conflict avoidance",
      "builder scope lock",
      "COMPLETE objective gates",
      "REPAIR/RESEARCH/VERIFY/BLOCKED routes",
      "state-transition guards",
      "end-to-end provenance"
    ]
  };

  if (typeof console !== "undefined") console.log("Titan WP3 self-test", result);
  if (typeof module === "object" && module.exports) module.exports = result;
  else globalThis.__titanWp3SelfTest = result;
})();
