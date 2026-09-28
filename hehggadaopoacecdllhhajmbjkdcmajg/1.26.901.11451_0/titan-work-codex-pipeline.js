(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TitanWorkCodexPipeline = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WORK_DECISIONS = Object.freeze(["CONTINUE_5", "READY_FOR_CODEX", "REDIRECT", "BLOCKED"]);
  const ORCHESTRATOR_DECISIONS = Object.freeze(["COMPLETE", "REPAIR", "RESEARCH", "VERIFY", "BLOCKED"]);
  const PIPELINE_STATES = Object.freeze({
    RESEARCH: "research",
    SUPERVISOR_REVIEW: "supervisor-review",
    DELTA_APPROVED: "delta-approved",
    BUILDER_DISPATCH: "builder-dispatch",
    BUILDING: "building",
    ORCHESTRATOR_REVIEW: "orchestrator-review",
    VERIFICATION: "verification",
    COMPLETE: "complete",
    BLOCKED: "blocked"
  });
  const NORMAL_EPOCH_MAX = 15;
  const VALID_EPOCHS = Object.freeze([5, 10, 15]);
  const WORK_SUPERVISOR_SLOTS = Object.freeze(["supervisor-a", "supervisor-b"]);
  const BUILDER_SLOTS = Object.freeze(["builder-a", "builder-b"]);

  const adapters = {
    missionControl: null,
    githubTruth: null,
    runtimeVerification: null,
    acceptanceVerification: null,
    audit: null,
    repository: null
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function requiredString(value, name) {
    assert(typeof value === "string" && value.trim(), name + " must be a non-empty string");
    return value.trim();
  }

  function arr(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function uniq(values) {
    return [...new Set(arr(values).filter(Boolean))];
  }

  function nowIso(clock) {
    return new Date(clock && typeof clock.now === "function" ? clock.now() : Date.now()).toISOString();
  }

  function provenanceRef(kind, value) {
    if (!value) return null;
    if (typeof value === "string") return { kind, id: value };
    return {
      kind,
      id: value.id || value.review_id || value.delta_id || value.packet_id || value.result_id || value.decision_id || null
    };
  }

  function audit(event, payload) {
    if (!adapters.audit) return;
    try {
      if (typeof adapters.audit === "function") adapters.audit(event, clone(payload));
      else if (typeof adapters.audit.append === "function") adapters.audit.append(event, clone(payload));
    } catch (_) {}
  }

  function registerAdapters(next) {
    Object.assign(adapters, next || {});
    return getAdapters();
  }

  function getAdapters() {
    return Object.assign({}, adapters);
  }

  function normalizeMission(mission) {
    assert(mission && typeof mission === "object", "mission is required");
    return {
      id: requiredString(mission.id || mission.mission_id, "mission.id"),
      title: String(mission.title || ""),
      goal: String(mission.goal || ""),
      repository: String(mission.repository || mission.repo || ""),
      branch: String(mission.branch || mission.branch_constraint || ""),
      constraints: arr(mission.constraints),
      acceptance_criteria: arr(mission.acceptance_criteria || mission.acceptanceCriteria || mission.acceptance),
      runtime_requirements: arr(mission.runtime_requirements || mission.runtimeRequirements || mission.verification_requirements || mission.verificationRequirements),
      metadata: clone(mission.metadata || {})
    };
  }

  function validateEpochPasses(passesCompleted) {
    assert(Number.isInteger(passesCompleted) && passesCompleted > 0, "passes_completed must be a positive integer");
    assert(passesCompleted <= NORMAL_EPOCH_MAX, "passes_completed exceeds normal 15-pass maximum");
    assert(passesCompleted % 5 === 0, "Work review epochs must land on 5-pass boundaries");
    return passesCompleted;
  }

  function createCycleReview(input, options) {
    input = input || {};
    const mission = normalizeMission(input.mission);
    const passes = validateEpochPasses(input.passes_completed || input.passesCompleted || 5);
    const nextDecision = requiredString(input.next_decision || input.nextDecision, "next_decision");
    assert(WORK_DECISIONS.includes(nextDecision), "invalid Work decision: " + nextDecision);
    if (nextDecision === "CONTINUE_5") assert(passes < NORMAL_EPOCH_MAX, "15 passes requires an explicit non-CONTINUE decision");

    const review = {
      schema_version: 1,
      review_id: requiredString(input.review_id || input.reviewId || "cr:" + mission.id + ":" + String(input.worker || "unknown") + ":" + String(input.cycle || 1) + ":" + passes, "review_id"),
      mission,
      worker: requiredString(String(input.worker || ""), "worker"),
      squad: requiredString(String(input.squad || ""), "squad"),
      cycle: Number.isInteger(input.cycle) && input.cycle > 0 ? input.cycle : 1,
      passes_completed: passes,
      approved_findings: arr(input.approved_findings || input.approvedFindings),
      rejected_findings: arr(input.rejected_findings || input.rejectedFindings),
      unresolved_questions: arr(input.unresolved_questions || input.unresolvedQuestions),
      architecture_implications: arr(input.architecture_implications || input.architectureImplications),
      dependencies: arr(input.dependencies),
      evidence_quality: clone(input.evidence_quality || input.evidenceQuality || {}),
      next_decision: nextDecision,
      redirect: input.redirect ? clone(input.redirect) : null,
      blocker: input.blocker ? clone(input.blocker) : null,
      created_at: nowIso(options && options.clock),
      provenance: arr(input.provenance).map(x => clone(x))
    };
    if (passes === 15 && nextDecision === "CONTINUE_5") throw new Error("normal research epoch maximum reached");
    audit("work.cycle_review.created", review);
    return review;
  }

  function nextResearchEpoch(review) {
    assert(review && typeof review === "object", "review is required");
    validateEpochPasses(review.passes_completed);
    switch (review.next_decision) {
      case "CONTINUE_5":
        return { action: "research", target_passes: review.passes_completed + 5, max_normal_passes: NORMAL_EPOCH_MAX };
      case "READY_FOR_CODEX":
        return { action: "compile-delta" };
      case "REDIRECT":
        return { action: "redirect", redirect: clone(review.redirect || {}) };
      case "BLOCKED":
        return { action: "mission-control-attention", blocker: clone(review.blocker || {}) };
      default:
        throw new Error("unknown Work decision");
    }
  }

  function normalizeScopePath(value, allowGlob) {
    let p=String(value||"").trim().replace(/\\/g,"/");
    assert(p,"scope path must be non-empty");
    assert(!/^[A-Za-z]:\//.test(p)&&!p.startsWith("/")&&!p.startsWith("//"),"absolute scope paths are not allowed");
    p=p.replace(/^\.\//,"").replace(/\/+/g,"/");
    const out=[];for(const part of p.split("/")){if(!part||part===".")continue;assert(part!=="..","scope path traversal is not allowed");if(allowGlob===false)assert(!part.includes("*"),"changed file path may not contain glob");assert(!(part.includes("**")&&part!=="**"),"double-star glob must occupy a whole segment");out.push(part)}
    assert(out.length>0,"scope path resolves to empty");return out.join("/");
  }
  function escapeScopeRegex(s){return s.replace(/[.+^$(){}|[\]\\]/g,"\\  function compileApprovedImplementationDelta(input, options) {")}
  function scopeRegex(scope) {
    const p=normalizeScopePath(scope,true);
    if(!p.includes("*"))return new RegExp("^"+escapeScopeRegex(p)+"(?:/.*)?$");
    const parts=p.split("/");let out="^";
    parts.forEach((part,index)=>{if(part==="**")out+=index===parts.length-1?"(?:.*)?":"(?:[^/]+/)*";else{let seg="";for(const ch of part)seg+=ch==="*"?"[^/]*":escapeScopeRegex(ch);out+=seg;if(index<parts.length-1)out+="/"}});
    return new RegExp(out+"$");
  }
  function scopeAllowsPath(scope,path){try{return scopeRegex(scope).test(normalizeScopePath(path,false))}catch{return false}}
  function scopeWithin(child,parent){const c=normalizeScopePath(child,true),p=normalizeScopePath(parent,true);if(c===p)return true;if(c.includes("*"))return false;return scopeAllowsPath(p,c)}

  function compileApprovedImplementationDelta(input, options) {
    input = input || {};
    const reviews = arr(input.cycle_reviews || input.cycleReviews);
    assert(reviews.length > 0, "at least one CycleReview is required");
    reviews.forEach(r => {
      assert(r.next_decision === "READY_FOR_CODEX", "all source reviews must be READY_FOR_CODEX");
    });
    const mission = normalizeMission(input.mission || reviews[0].mission);
    assert(reviews.every(r => r.mission && (r.mission.id || r.mission.mission_id) === mission.id), "CycleReview mission mismatch");

    const scopePaths = uniq(input.scope_paths || input.scopePaths).map(path => normalizeScopePath(path, true));
    assert(scopePaths.length > 0, "scope_paths must be non-empty");
    const tests = arr(input.tests);
    const acceptance = arr(input.acceptance_criteria || input.acceptanceCriteria || mission.acceptance_criteria);

    const delta = {
      schema_version: 1,
      delta_id: requiredString(input.delta_id || input.deltaId || "delta:" + mission.id + ":" + Date.now(), "delta_id"),
      mission,
      validated_findings: arr(input.validated_findings || input.validatedFindings),
      required_changes: arr(input.required_changes || input.requiredChanges),
      scope_paths: scopePaths,
      expected_files: uniq(input.expected_files || input.expectedFiles),
      expected_symbols: uniq(input.expected_symbols || input.expectedSymbols),
      dependencies: arr(input.dependencies),
      architecture_constraints: arr(input.architecture_constraints || input.architectureConstraints || mission.constraints),
      tests,
      acceptance_criteria: acceptance,
      runtime_verification: arr(input.runtime_verification || input.runtimeVerification || mission.runtime_requirements),
      rejected_approaches: arr(input.rejected_approaches || input.rejectedApproaches),
      unresolved_caveats: arr(input.unresolved_caveats || input.unresolvedCaveats),
      source_cycle_reviews: reviews.map(r => provenanceRef("cycle-review", r)).filter(Boolean),
      created_at: nowIso(options && options.clock)
    };
    audit("work.delta.approved", delta);
    return delta;
  }

  function chooseWorkSupervisor(input) {
    input = input || {};
    const squad = String(input.squad || "").toUpperCase();
    const requested = input.supervisor_slot || input.supervisorSlot || null;
    if (requested) {
      assert(WORK_SUPERVISOR_SLOTS.includes(requested), "invalid Work supervisor slot");
      if (squad === "A") assert(requested === "supervisor-a", "Squad A must route to supervisor-a");
      if (squad === "B") assert(requested === "supervisor-b", "Squad B must route to supervisor-b");
      return requested;
    }
    if (squad === "A") return "supervisor-a";
    if (squad === "B") return "supervisor-b";
    throw new Error("unable to route Work supervisor without squad A/B");
  }

  function adaptChatSupervisorReviewEvent(event, mission) {
    assert(event && typeof event === "object", "chat supervisor-review event is required");
    assert(event.type === "supervisor_review_required", "unexpected chat event type");
    const detail = event.detail || {};
    const completedPasses = arr(detail.completedPasses);
    assert(completedPasses.length === 5, "supervisor review requires exactly five completed Chat passes");
    return createSupervisorReviewRequest({
      mission: mission,
      worker: event.workerId,
      squad: event.squad,
      cycle: event.cycle || 1,
      passes_completed: completedPasses.length,
      chat_cycle: {
        mission_id: event.missionId || detail.missionId || null,
        cycle_id: event.cycleId || detail.cycleId || null,
        completed_passes: clone(completedPasses),
        event_at: event.at || null
      },
      provenance: [{ kind: "chat-event", id: [event.missionId || "", event.cycleId || "", event.workerId || "", "supervisor_review_required"].join(":") }]
    });
  }

  function createSupervisorReviewRequest(input) {
    input = input || {};
    const slot = chooseWorkSupervisor(input);
    return {
      schema_version: 1,
      supervisor_slot: slot,
      mission: normalizeMission(input.mission),
      worker: requiredString(String(input.worker || ""), "worker"),
      squad: requiredString(String(input.squad || ""), "squad"),
      cycle: Number.isInteger(input.cycle) && input.cycle > 0 ? input.cycle : 1,
      passes_completed: validateEpochPasses(input.passes_completed || input.passesCompleted || 5),
      chat_cycle: clone(input.chat_cycle || input.chatCycle || null),
      provenance: arr(input.provenance)
    };
  }

  function createCodexImplementationPacket(delta, input, options) {
    input = input || {};
    assert(delta && delta.delta_id, "ApprovedImplementationDelta is required");
    const packet = {
      schema_version: 1,
      packet_id: requiredString(input.packet_id || input.packetId || "packet:" + delta.delta_id + ":" + (input.builder_slot || input.builderSlot || "unassigned"), "packet_id"),
      mission: clone(delta.mission),
      delta_id: delta.delta_id,
      repository: String(input.repository || delta.mission.repository || ""),
      builder_slot: input.builder_slot || input.builderSlot || null,
      scope_paths: uniq(input.scope_paths || input.scopePaths || delta.scope_paths).map(path => normalizeScopePath(path, true)),
      expected_files: uniq(input.expected_files || input.expectedFiles || delta.expected_files),
      expected_symbols: uniq(input.expected_symbols || input.expectedSymbols || delta.expected_symbols),
      required_changes: arr(input.required_changes || input.requiredChanges || delta.required_changes),
      architecture_constraints: arr(input.architecture_constraints || input.architectureConstraints || delta.architecture_constraints),
      dependencies: arr(input.dependencies || delta.dependencies),
      tests: arr(input.tests || delta.tests),
      acceptance_criteria: arr(input.acceptance_criteria || input.acceptanceCriteria || delta.acceptance_criteria),
      runtime_verification: arr(input.runtime_verification || input.runtimeVerification || delta.runtime_verification),
      prohibited_approaches: arr(input.prohibited_approaches || input.prohibitedApproaches || delta.rejected_approaches),
      caveats: arr(input.caveats || delta.unresolved_caveats),
      provenance: [provenanceRef("approved-delta", delta)].filter(Boolean),
      created_at: nowIso(options && options.clock)
    };
    const deltaScopes=delta.scope_paths.map(path=>normalizeScopePath(path,true));
    assert(packet.scope_paths.every(path=>deltaScopes.some(parent=>scopeWithin(path,parent))), "Codex packet scope may not expand beyond ApprovedImplementationDelta");
    return packet;
  }

  function pathsConflict(a, b) {
    const aa = uniq(a), bb = uniq(b);
    return aa.some(x => bb.some(y => x === y || x.startsWith(y.replace(/\/$/, "") + "/") || y.startsWith(x.replace(/\/$/, "") + "/")));
  }

  function dependencyId(dep) {
    if (typeof dep === "string") return dep;
    return dep && (dep.id || dep.mission_id || dep.missionId || dep.name) || null;
  }

  function dependencyIsComplete(dep, completed) {
    if (dep && typeof dep === "object") {
      const status = String(dep.status || dep.state || "").toLowerCase();
      if (["complete", "completed", "verified", "merged", "done"].includes(status)) return true;
    }
    const id = dependencyId(dep);
    return Boolean(id && completed.includes(id));
  }

  function unresolvedDependencies(packet, state) {
    const completed = uniq((state && (state.completed_dependencies || state.completedDependencies)) || []);
    return arr(packet.dependencies).filter(dep => !dependencyIsComplete(dep, completed));
  }

  function builderCompatible(packet, slotState, globalState) {
    const s = slotState || {};
    if (s.blocked) return { ok: false, reason: "builder-blocked" };
    if (s.repository && packet.repository && s.repository !== packet.repository) {
      return { ok: false, reason: "repository-mismatch" };
    }
    if (pathsConflict(packet.scope_paths, arr(s.owned_paths))) {
      return { ok: false, reason: "ownership-conflict" };
    }
    const explicitConflicts = uniq(s.conflicting_files || s.conflictingFiles);
    if (pathsConflict(packet.expected_files, explicitConflicts) || pathsConflict(packet.scope_paths, explicitConflicts)) {
      return { ok: false, reason: "file-conflict" };
    }
    const unresolved = unresolvedDependencies(packet, globalState || {});
    if (unresolved.length) {
      return { ok: false, reason: "dependencies-unresolved", unresolved_dependencies: clone(unresolved) };
    }
    return { ok: true };
  }

  function chooseBuilder(packet, state) {
    state = state || {};
    const slots = BUILDER_SLOTS.map(id => {
      const raw = state[id] || {};
      return {
        id,
        workload: Number(raw.workload || 0),
        repository: raw.repository || "",
        scope_paths: arr(raw.scope_paths),
        owned_paths: arr(raw.owned_paths),
        conflicting_files: arr(raw.conflicting_files || raw.conflictingFiles),
        blocked: Boolean(raw.blocked),
        raw
      };
    });

    const candidates = slots.filter(s => builderCompatible(packet, s.raw, state).ok);
    assert(candidates.length > 0, "no compatible Codex builder: blocked, repository/scope/file conflict, or unresolved dependencies");
    candidates.sort((a, b) => a.workload - b.workload || a.id.localeCompare(b.id));
    return candidates[0].id;
  }

  function assignBuilder(delta, input, state, options) {
    input = input || {};
    const provisional = createCodexImplementationPacket(delta, input, options);
    const requested = input.builder_slot || input.builderSlot || null;
    let slot;

    if (requested) {
      assert(BUILDER_SLOTS.includes(requested), "invalid builder slot");
      const verdict = builderCompatible(provisional, (state || {})[requested] || {}, state || {});
      assert(verdict.ok, "requested builder incompatible: " + verdict.reason);
      slot = requested;
    } else {
      slot = chooseBuilder(provisional, state);
    }

    const packet = Object.assign({}, provisional, {
      builder_slot: slot,
      packet_id: input.packet_id || input.packetId || "packet:" + delta.delta_id + ":" + slot
    });
    audit("codex.builder.assigned", packet);
    return packet;
  }

  function createBuilderResult(input, options) {
    input = input || {};
    const packet = input.packet || null;
    const result = {
      schema_version: 1,
      result_id: requiredString(input.result_id || input.resultId || "builder-result:" + (packet ? packet.packet_id : Date.now()), "result_id"),
      packet_id: requiredString(input.packet_id || input.packetId || (packet && packet.packet_id), "packet_id"),
      builder_slot: requiredString(input.builder_slot || input.builderSlot || (packet && packet.builder_slot), "builder_slot"),
      files_changed: uniq(input.files_changed || input.filesChanged).map(path => normalizeScopePath(path, false)),
      diff: String(input.diff || ""),
      tests: arr(input.tests),
      commit: clone(input.commit || null),
      branch: clone(input.branch || null),
      pr: clone(input.pr || null),
      ci: clone(input.ci || null),
      blockers: arr(input.blockers),
      remaining_implementation: arr(input.remaining_implementation || input.remainingImplementation),
      provenance: arr(input.provenance),
      created_at: nowIso(options && options.clock)
    };
    assert(BUILDER_SLOTS.includes(result.builder_slot), "invalid builder slot");
    if (packet) {
      assert(result.files_changed.every(path => packet.scope_paths.some(scope => scopeAllowsPath(scope,path))), "builder changed file outside packet scope");
      result.provenance.push(provenanceRef("codex-packet", packet));
    }
    audit("codex.builder.result", result);
    return result;
  }

  function createOrchestratorBundle(input, options) {
    input = input || {};
    const mission = normalizeMission(input.mission);
    const deltas = arr(input.approved_deltas || input.approvedDeltas);
    const builderResults = arr(input.builder_results || input.builderResults);
    assert(deltas.length > 0, "orchestrator requires ApprovedImplementationDelta");
    const bundle = {
      schema_version: 1,
      mission,
      approved_deltas: clone(deltas),
      builder_results: clone(builderResults),
      actual_git_diff: String(input.actual_git_diff || input.actualGitDiff || ""),
      commits: arr(input.commits),
      prs: arr(input.prs),
      ci: clone(input.ci || null),
      tests: arr(input.tests),
      architecture_constraints: arr(input.architecture_constraints || input.architectureConstraints || mission.constraints),
      runtime_evidence: clone(input.runtime_evidence || input.runtimeEvidence || null),
      acceptance_evidence: clone(input.acceptance_evidence || input.acceptanceEvidence || null),
      github_truth: clone(input.github_truth || input.githubTruth || null),
      created_at: nowIso(options && options.clock),
      provenance: [
        ...deltas.map(d => provenanceRef("approved-delta", d)),
        ...builderResults.map(r => provenanceRef("builder-result", r))
      ].filter(Boolean)
    };
    return bundle;
  }

  function objectiveGates(bundle) {
    const truth = bundle.github_truth || {};
    const runtime = bundle.runtime_evidence || {};
    const acceptance = bundle.acceptance_evidence || {};
    const tests = arr(bundle.tests);
    const builderResults = arr(bundle.builder_results);

    const git = Boolean(truth.commitExists && truth.ciPassed && truth.merged && truth.presentOnMain);
    const runtimeRequired = arr(bundle.mission.runtime_requirements).length > 0;
    const runtimeOk = runtimeRequired
      ? Boolean(runtime.deployed && runtime.browserPassed && runtime.consoleClean && runtime.networkPassed && runtime.acceptancePassed && (runtime.serverRequired ? runtime.serverPassed : true))
      : Boolean(runtime.passed === true || runtime.acceptancePassed === true || !runtimeRequired);
    const acceptanceOk = acceptance.passed === true || (Array.isArray(acceptance.criteria) && acceptance.criteria.length > 0 && acceptance.criteria.every(c => c && c.done === true));
    const testsOk = tests.length === 0 || tests.every(t => t && (t.passed === true || t.status === "passed"));
    const buildersDone = builderResults.length > 0 && builderResults.every(r => arr(r.blockers).length === 0 && arr(r.remaining_implementation).length === 0);

    return { git, runtime: runtimeOk, acceptance: acceptanceOk, tests: testsOk, builders: buildersDone };
  }

  function decideOrchestrator(bundle, hints, options) {
    hints = hints || {};
    const gates = objectiveGates(bundle);
    let state;
    let reason;
    let route = null;

    if (hints.blocked || arr(bundle.builder_results).some(r => arr(r.blockers).length > 0)) {
      state = "BLOCKED";
      reason = hints.reason || "builder or external blocker requires Mission Control attention";
      route = { target: "mission-control", payload: clone(hints.blocker || {}) };
    } else if (hints.research_required) {
      state = "RESEARCH";
      reason = hints.reason || "implementation decision requires bounded additional research";
      route = { target: hints.squad || "chat-squad", request: clone(hints.research_request || {}) };
    } else if (hints.repair_required || !gates.tests || !gates.builders) {
      state = "REPAIR";
      reason = hints.reason || "implementation or tests require bounded repair";
      route = { target: hints.builder_slot || "appropriate-builder", packet: clone(hints.repair_packet || {}) };
    } else if (!gates.git || !gates.runtime || !gates.acceptance) {
      state = "VERIFY";
      reason = hints.reason || "objective completion gates are not yet satisfied";
      route = { target: "verification-plane", missing: Object.keys(gates).filter(k => !gates[k]) };
    } else {
      state = "COMPLETE";
      reason = hints.reason || "all objective gates satisfied";
    }

    const decision = {
      schema_version: 1,
      decision_id: requiredString(hints.decision_id || hints.decisionId || "orch:" + bundle.mission.id + ":" + Date.now(), "decision_id"),
      mission_id: bundle.mission.id,
      state,
      reason,
      route,
      gates,
      created_at: nowIso(options && options.clock),
      provenance: arr(bundle.provenance)
    };
    if (state === "COMPLETE") assert(gates.git && gates.runtime && gates.acceptance && gates.tests && gates.builders, "COMPLETE cannot bypass objective gates");
    audit("codex.orchestrator.decision", decision);
    return decision;
  }

  function transition(currentState, decision) {
    const allowed = {
      [PIPELINE_STATES.RESEARCH]: [PIPELINE_STATES.SUPERVISOR_REVIEW, PIPELINE_STATES.BLOCKED],
      [PIPELINE_STATES.SUPERVISOR_REVIEW]: [PIPELINE_STATES.RESEARCH, PIPELINE_STATES.DELTA_APPROVED, PIPELINE_STATES.BLOCKED],
      [PIPELINE_STATES.DELTA_APPROVED]: [PIPELINE_STATES.BUILDER_DISPATCH, PIPELINE_STATES.BLOCKED],
      [PIPELINE_STATES.BUILDER_DISPATCH]: [PIPELINE_STATES.BUILDING, PIPELINE_STATES.BLOCKED],
      [PIPELINE_STATES.BUILDING]: [PIPELINE_STATES.ORCHESTRATOR_REVIEW, PIPELINE_STATES.BLOCKED],
      [PIPELINE_STATES.ORCHESTRATOR_REVIEW]: [PIPELINE_STATES.BUILDING, PIPELINE_STATES.RESEARCH, PIPELINE_STATES.VERIFICATION, PIPELINE_STATES.BLOCKED, PIPELINE_STATES.COMPLETE],
      [PIPELINE_STATES.VERIFICATION]: [PIPELINE_STATES.ORCHESTRATOR_REVIEW, PIPELINE_STATES.COMPLETE, PIPELINE_STATES.BLOCKED],
      [PIPELINE_STATES.BLOCKED]: [PIPELINE_STATES.RESEARCH, PIPELINE_STATES.BUILDING, PIPELINE_STATES.VERIFICATION],
      [PIPELINE_STATES.COMPLETE]: []
    };
    assert(allowed[currentState], "unknown pipeline state: " + currentState);
    assert(allowed[currentState].includes(decision), "invalid pipeline transition " + currentState + " -> " + decision);
    return decision;
  }

  function routeOrchestratorDecision(decision) {
    assert(decision && ORCHESTRATOR_DECISIONS.includes(decision.state), "valid orchestrator decision required");
    if (decision.state === "REPAIR") return { action: "send-builder-repair", target: decision.route && decision.route.target, payload: decision.route && decision.route.packet };
    if (decision.state === "RESEARCH") return { action: "send-chat-research", target: decision.route && decision.route.target, payload: decision.route && decision.route.request };
    if (decision.state === "VERIFY") return { action: "run-verification", target: "verification-plane", payload: decision.route };
    if (decision.state === "BLOCKED") return { action: "mission-control-attention", target: "mission-control", payload: decision.route };
    return { action: "run-final-gates", target: "objective-gates", payload: decision.gates };
  }

  function buildProvenanceChain(parts) {
    parts = parts || {};
    return {
      mission: provenanceRef("mission", parts.mission && (parts.mission.id || parts.mission.mission_id)),
      chat_cycles: arr(parts.chat_cycles || parts.chatCycles).map(v => clone(v)),
      cycle_reviews: arr(parts.cycle_reviews || parts.cycleReviews).map(v => provenanceRef("cycle-review", v)).filter(Boolean),
      approved_deltas: arr(parts.approved_deltas || parts.approvedDeltas).map(v => provenanceRef("approved-delta", v)).filter(Boolean),
      codex_packets: arr(parts.codex_packets || parts.codexPackets).map(v => provenanceRef("codex-packet", v)).filter(Boolean),
      builder_results: arr(parts.builder_results || parts.builderResults).map(v => provenanceRef("builder-result", v)).filter(Boolean),
      orchestrator_decisions: arr(parts.orchestrator_decisions || parts.orchestratorDecisions).map(v => provenanceRef("orchestrator-decision", v)).filter(Boolean),
      verification: clone(parts.verification || null)
    };
  }

  async function collectVerificationEvidence(bundle) {
    const evidence = {};
    if (typeof adapters.githubTruth === "function") evidence.github_truth = await adapters.githubTruth({ mission: clone(bundle.mission), bundle: clone(bundle) });
    else if (adapters.githubTruth && typeof adapters.githubTruth.verify === "function") evidence.github_truth = await adapters.githubTruth.verify({ mission: clone(bundle.mission), bundle: clone(bundle) });

    if (typeof adapters.runtimeVerification === "function") evidence.runtime_evidence = await adapters.runtimeVerification({ mission: clone(bundle.mission), requirements: clone(bundle.mission.runtime_requirements), bundle: clone(bundle) });
    else if (adapters.runtimeVerification && typeof adapters.runtimeVerification.verify === "function") evidence.runtime_evidence = await adapters.runtimeVerification.verify({ mission: clone(bundle.mission), requirements: clone(bundle.mission.runtime_requirements), bundle: clone(bundle) });

    if (typeof adapters.acceptanceVerification === "function") evidence.acceptance_evidence = await adapters.acceptanceVerification({ mission: clone(bundle.mission), bundle: clone(bundle) });
    else if (adapters.acceptanceVerification && typeof adapters.acceptanceVerification.verify === "function") evidence.acceptance_evidence = await adapters.acceptanceVerification.verify({ mission: clone(bundle.mission), bundle: clone(bundle) });

    audit("verification.evidence.collected", { mission_id: bundle.mission.id, evidence });
    return evidence;
  }

  return Object.freeze({
    version: "0.1.0",
    WORK_DECISIONS,
    ORCHESTRATOR_DECISIONS,
    PIPELINE_STATES,
    VALID_EPOCHS,
    NORMAL_EPOCH_MAX,
    WORK_SUPERVISOR_SLOTS,
    BUILDER_SLOTS,
    registerAdapters,
    getAdapters,
    normalizeMission,
    adaptChatSupervisorReviewEvent,
    chooseWorkSupervisor,
    createSupervisorReviewRequest,
    createCycleReview,
    nextResearchEpoch,
    compileApprovedImplementationDelta,
    createCodexImplementationPacket,
    chooseBuilder,
    assignBuilder,
    createBuilderResult,
    createOrchestratorBundle,
    objectiveGates,
    decideOrchestrator,
    routeOrchestratorDecision,
    transition,
    buildProvenanceChain,
    collectVerificationEvidence,
    unresolvedDependencies,
    builderCompatible,
    pathsConflict
  });
});
