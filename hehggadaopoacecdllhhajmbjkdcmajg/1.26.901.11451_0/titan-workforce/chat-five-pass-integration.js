(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./chat-five-pass-scheduler.js")
      : root.TitanChatFivePass
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TitanChatFivePassIntegration = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (schedulerApi) {
  "use strict";

  if (!schedulerApi || !schedulerApi.ChatFivePassScheduler) {
    throw new Error("TitanChatFivePass scheduler API is required");
  }

  const { ChatFivePassScheduler, STATES } = schedulerApi;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function legacyWorker(source, id) {
    if (!source || typeof source !== "object") return null;
    const pass = Math.max(0, Math.min(5, Number(source.passCount || source.pass || 0)));
    const completed = Array.isArray(source.completedPasses)
      ? clone(source.completedPasses).slice(0, pass)
      : [];
    return {
      id,
      executionClass: "chat_worker",
      squad: "A",
      conversationIdentity:
        source.conversationIdentity ||
        source.conversationId ||
        source.conversationUrl ||
        null,
      missionId:
        source.missionId ||
        (source.mission && source.mission.id) ||
        null,
      cycleId:
        source.cycleId ||
        (source.mission && source.mission.cycleId) ||
        null,
      queue: Array.isArray(source.queue) && source.queue.length === 5
        ? source.queue.slice()
        : [],
      currentPass: pass,
      completedPasses: completed,
      lastDispatchAt: source.lastDispatchAt || source.lastSendAt || null,
      nextGateAt: source.nextGateAt || source.nextDueAt || null,
      health: source.health || "migrated",
      state:
        source.quarantined ? STATES.QUARANTINED :
        source.paused ? STATES.PAUSED :
        source.blocked ? STATES.BLOCKED :
        pass >= 5 && completed.length >= 5 ? STATES.CYCLE_COMPLETE :
        STATES.WAITING_GATE,
      slowdown: ["normal", "moderate", "high"].includes(source.slowdown)
        ? source.slowdown
        : "normal",
      pauseReason: source.pauseReason || null,
      blockReason: source.blockReason || null,
      actionKeys: Array.isArray(source.actionKeys)
        ? source.actionKeys.slice(-100)
        : [],
      revision: Number(source.revision || 0) + 1
    };
  }

  function migrateLegacyFiveByFive(legacyState) {
    const fresh = new ChatFivePassScheduler();
    const snapshot = fresh.snapshot();
    const sourceWorkers =
      (legacyState && legacyState.workers) ||
      (legacyState && legacyState.workerState) ||
      {};

    for (let n = 1; n <= 5; n++) {
      const old =
        sourceWorkers["W" + n] ||
        sourceWorkers[n] ||
        sourceWorkers[String(n)] ||
        null;
      const migrated = legacyWorker(old, "A" + n);
      if (migrated) snapshot.workers["A" + n] = migrated;
    }

    if (legacyState && Array.isArray(legacyState.audit)) {
      snapshot.audit = legacyState.audit.slice(-500);
    } else if (legacyState && Array.isArray(legacyState.auditLog)) {
      snapshot.audit = legacyState.auditLog.slice(-500);
    }

    snapshot.version = 1;
    snapshot.migration = {
      source: "titan-5x5-v3.0.34",
      mapped: "W1-W5 -> A1-A5",
      createdFresh: ["B1", "B2", "B3", "B4", "B5"]
    };
    return snapshot;
  }

  class GuardedChatFivePassScheduler extends ChatFivePassScheduler {
    constructor(options = {}) {
      super(options);
      this.advanceGuard =
        typeof options.advanceGuard === "function"
          ? options.advanceGuard
          : null;
    }

    inspectGate(id, observation = {}) {
      const preliminary = super.inspectGate(id, observation);
      if (preliminary.action !== "dispatch" || !this.advanceGuard) {
        return preliminary;
      }

      const worker = this.getWorker(id);
      const verdict = this.advanceGuard(clone(worker), clone(preliminary));

      if (verdict === false || (verdict && verdict.allowed === false)) {
        const reason =
          verdict && verdict.reason
            ? verdict.reason
            : "MISSION_BUDGET_OR_ANTI_LOOP_GUARD";

        this.block(id, reason);
        return {
          action: "blocked",
          reason,
          guard: true,
          worker: clone(this.getWorker(id))
        };
      }

      return preliminary;
    }

    static restore(snapshot, options = {}) {
      const base = ChatFivePassScheduler.restore(snapshot, options);
      const guarded = new GuardedChatFivePassScheduler(options);
      guarded.workers = base.workers;
      guarded.audit = base.audit;
      guarded.version = base.version;
      return guarded;
    }
  }

  return {
    GuardedChatFivePassScheduler,
    migrateLegacyFiveByFive
  };
});
