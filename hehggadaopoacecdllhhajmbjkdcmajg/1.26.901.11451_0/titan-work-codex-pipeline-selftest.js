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

  const adaptedMission = api.normalizeMission({
    id: "mission-alias",
    repo: "example/repo",
    acceptance: [{ id: "a" }],
    verificationRequirements: ["browser"]
  });
  ok(adaptedMission.repository === "example/repo", "Mission repo alias should normalize");
  ok(adaptedMission.acceptance_criteria.length === 1, "Mission acceptance alias should normalize");
  ok(adaptedMission.runtime_requirements.length === 1, "Mission verification requirements alias should normalize");

  const wp2Event = {
    type: "supervisor_review_required",
    at: 5000,
    workerId: "B2",
    squad: "B",
    missionId: "mission-1",
    cycleId: "cycle-7",
    detail: {
      completedPasses: [1,2,3,4,5].map(n => ({ passNumber: n, result: { ok: true } }))
    }
  };
  const adaptedReviewRequest = api.adaptChatSupervisorReviewEvent(wp2Event, mission());
  ok(adaptedReviewRequest.supervisor_slot === "supervisor-b", "WP2 Squad B event must route to Work Supervisor B");
  ok(adaptedReviewRequest.chat_cycle.cycle_id === "cycle-7", "WP2 cycle identity must be preserved");
  expectThrow(() => api.adaptChatSupervisorReviewEvent({
    type: "supervisor_review_required",
    workerId: "A1",
    squad: "A",
    detail: { completedPasses: [1,2,3,4] }
  }, mission()), "malformed WP2 supervisor event must fail closed");

  const supervisorA = api.createSupervisorReviewRequest({
    mission: mission(),
    worker: "A1",
    squad: "A",
    cycle: 1,
    passes_completed: 5,
    chat_cycle: { id: "cycle-a1-1" }
  });
  ok(supervisorA.supervisor_slot === "supervisor-a", "Squad A must route to Work Supervisor A");
  expectThrow(() => api.createSupervisorReviewRequest({
    mission: mission(),
    worker: "A1",
    squad: "A",
    cycle: 1,
    passes_completed: 5,
    supervisor_slot: "supervisor-b"
  }), "explicit Work supervisor mismatch must fail closed");

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

  const narrowedPacket=api.createCodexImplementationPacket(delta,{scope_paths:["src/pipeline/nested"]});
  ok(narrowedPacket.scope_paths[0]==="src/pipeline/nested","packet may narrow to descendant scope");
  ok(api.scopeAllowsPath("src/pipeline","src/pipeline/index.js"),"plain scope subtree");
  ok(api.scopeAllowsPath("src/**","src/deep/nested/file.js"),"double glob nested");
  ok(api.scopeAllowsPath("tests/*.js","tests/a.js"),"single glob");
  ok(!api.scopeAllowsPath("tests/*.js","tests/deep/a.js"),"single glob crossed segment");
  ok(api.scopeAllowsPath("src\\windows","src\\windows\\file.js"),"Windows separator normalization");
  ok(!api.scopeAllowsPath("src/pipeline","src/pipelines/file.js"),"sibling prefix escape");
  expectThrow(()=>api.createBuilderResult({packet:Object.assign({},packet,{builder_slot:"builder-a"}),files_changed:["src/pipeline/../outside.js"]}),"builder traversal path must fail closed");

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

  expectThrow(() => api.assignBuilder(delta, { builder_slot: "builder-a" }, {
    "builder-a": { workload: 0, repository: "example/repo", owned_paths: ["src/pipeline"] },
    "builder-b": { workload: 0, repository: "example/repo" }
  }), "explicit builder assignment must still honor ownership conflicts");

  const depDelta = api.compileApprovedImplementationDelta({
    mission: mission(),
    cycle_reviews: [review],
    required_changes: ["dependent change"],
    scope_paths: ["src/dependent"],
    expected_files: ["src/dependent/index.js"],
    dependencies: ["mission-prereq"]
  });
  expectThrow(() => api.assignBuilder(depDelta, {}, {
    "builder-a": { workload: 0, repository: "example/repo" },
    "builder-b": { workload: 0, repository: "example/repo" },
    completed_dependencies: []
  }), "unresolved dependencies must block builder assignment");
  const depPacket = api.assignBuilder(depDelta, {}, {
    "builder-a": { workload: 1, repository: "example/repo" },
    "builder-b": { workload: 0, repository: "example/repo" },
    completed_dependencies: ["mission-prereq"]
  });
  ok(depPacket.builder_slot === "builder-b", "resolved dependencies should permit assignment");

  expectThrow(() => api.assignBuilder(delta, {}, {
    "builder-a": { workload: 0, repository: "example/repo", conflicting_files: ["src/pipeline/index.js"] },
    "builder-b": { workload: 0, repository: "example/repo", conflicting_files: ["src/pipeline/index.js"] }
  }), "explicit conflicting files must block builder assignment");

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

  const validTransitions = [
    [api.PIPELINE_STATES.RESEARCH, api.PIPELINE_STATES.SUPERVISOR_REVIEW],
    [api.PIPELINE_STATES.SUPERVISOR_REVIEW, api.PIPELINE_STATES.RESEARCH],
    [api.PIPELINE_STATES.SUPERVISOR_REVIEW, api.PIPELINE_STATES.DELTA_APPROVED],
    [api.PIPELINE_STATES.DELTA_APPROVED, api.PIPELINE_STATES.BUILDER_DISPATCH],
    [api.PIPELINE_STATES.BUILDER_DISPATCH, api.PIPELINE_STATES.BUILDING],
    [api.PIPELINE_STATES.BUILDING, api.PIPELINE_STATES.ORCHESTRATOR_REVIEW],
    [api.PIPELINE_STATES.ORCHESTRATOR_REVIEW, api.PIPELINE_STATES.BUILDING],
    [api.PIPELINE_STATES.ORCHESTRATOR_REVIEW, api.PIPELINE_STATES.RESEARCH],
    [api.PIPELINE_STATES.ORCHESTRATOR_REVIEW, api.PIPELINE_STATES.VERIFICATION],
    [api.PIPELINE_STATES.ORCHESTRATOR_REVIEW, api.PIPELINE_STATES.BLOCKED],
    [api.PIPELINE_STATES.ORCHESTRATOR_REVIEW, api.PIPELINE_STATES.COMPLETE],
    [api.PIPELINE_STATES.VERIFICATION, api.PIPELINE_STATES.ORCHESTRATOR_REVIEW],
    [api.PIPELINE_STATES.VERIFICATION, api.PIPELINE_STATES.COMPLETE],
    [api.PIPELINE_STATES.VERIFICATION, api.PIPELINE_STATES.BLOCKED],
    [api.PIPELINE_STATES.BLOCKED, api.PIPELINE_STATES.RESEARCH],
    [api.PIPELINE_STATES.BLOCKED, api.PIPELINE_STATES.BUILDING],
    [api.PIPELINE_STATES.BLOCKED, api.PIPELINE_STATES.VERIFICATION]
  ];
  validTransitions.forEach(([from, to]) => ok(api.transition(from, to) === to, "valid transition should pass: " + from + " -> " + to));
  expectThrow(() => api.transition(api.PIPELINE_STATES.RESEARCH, api.PIPELINE_STATES.COMPLETE), "research must not jump directly to COMPLETE");
  expectThrow(() => api.transition(api.PIPELINE_STATES.COMPLETE, api.PIPELINE_STATES.RESEARCH), "COMPLETE must be terminal");

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
      "WP1/Mission Control alias normalization",
      "WP2 supervisor_review_required event adaptation",
      "Work Supervisor A/B deterministic routing",
      "CycleReview -> ApprovedImplementationDelta provenance",
      "delta approval validation",
      "Builder A/B workload routing",
      "explicit builder conflict enforcement",
      "dependency readiness enforcement",
      "conflicting-file enforcement",
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
