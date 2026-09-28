(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TitanChatFivePass = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATES = Object.freeze({
    READY: "READY",
    BUSY: "BUSY",
    WAITING_GATE: "WAITING_GATE",
    CYCLE_COMPLETE: "CYCLE_COMPLETE",
    BLOCKED: "BLOCKED",
    PAUSED: "PAUSED",
    QUARANTINED: "QUARANTINED"
  });

  const EVENTS = Object.freeze({
    CYCLE_STARTED: "cycle_started",
    PASS_DISPATCHED: "pass_dispatched",
    WORKER_BUSY: "worker_busy",
    PASS_COMPLETED: "pass_completed",
    CYCLE_COMPLETE: "cycle_complete",
    BLOCKED: "blocked",
    SUPERVISOR_REVIEW_REQUIRED: "supervisor_review_required"
  });

  const DEFAULT_GATE_MS = 5 * 60 * 1000;
  const SLOWDOWN = Object.freeze({ normal: 1, moderate: 2, high: 3 });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function nowFrom(clock) {
    return typeof clock === "function" ? Number(clock()) : Date.now();
  }

  function makeWorker(id, squad) {
    return {
      id,
      executionClass: "chat_worker",
      squad,
      conversationIdentity: null,
      missionId: null,
      cycleId: null,
      queue: [],
      currentPass: 0,
      completedPasses: [],
      lastDispatchAt: null,
      nextGateAt: null,
      health: "unknown",
      state: STATES.READY,
      slowdown: "normal",
      pauseReason: null,
      blockReason: null,
      actionKeys: [],
      revision: 0
    };
  }

  function defaultRoster() {
    const workers = {};
    for (const squad of ["A", "B"]) {
      for (let n = 1; n <= 5; n++) {
        const id = squad + n;
        workers[id] = makeWorker(id, squad);
      }
    }
    return workers;
  }

  function validateQueue(queue) {
    if (!Array.isArray(queue) || queue.length !== 5) {
      throw new Error("five-pass queue must contain exactly 5 instructions");
    }
    queue.forEach((instruction, i) => {
      if (typeof instruction !== "string" || !instruction.trim()) {
        throw new Error("pass " + (i + 1) + " instruction must be non-empty text");
      }
    });
  }

  function actionKey(worker, passNumber) {
    return [worker.missionId || "", worker.cycleId || "", worker.id, passNumber].join("/");
  }

  class ChatFivePassScheduler {
    constructor(options = {}) {
      this.clock = options.clock || Date.now;
      this.minimumGateMs = Math.max(DEFAULT_GATE_MS, Number(options.minimumGateMs || DEFAULT_GATE_MS));
      this.squadBOffsetMs = Math.max(
        0,
        Number(options.squadBOffsetMs == null ? Math.floor(this.minimumGateMs / 2) : options.squadBOffsetMs)
      );
      this.staggerStepMs = Math.max(
        0,
        Number(options.staggerStepMs == null ? Math.floor(this.minimumGateMs / 5) : options.staggerStepMs)
      );
      this.emit = typeof options.emit === "function" ? options.emit : function () {};
      this.workers = defaultRoster();
      this.audit = [];
      this.maxAudit = Math.max(50, Number(options.maxAudit || 500));
      this.version = 1;
    }

    static restore(snapshot, options = {}) {
      const scheduler = new ChatFivePassScheduler(options);
      if (!snapshot || typeof snapshot !== "object") return scheduler;
      const restored = snapshot.workers || {};
      for (const [id, base] of Object.entries(scheduler.workers)) {
        const candidate = restored[id];
        scheduler.workers[id] = candidate
          ? Object.assign(base, clone(candidate), { id, executionClass: "chat_worker", squad: id[0] })
          : base;
      }
      scheduler.audit = Array.isArray(snapshot.audit) ? snapshot.audit.slice(-scheduler.maxAudit) : [];
      scheduler.version = Number(snapshot.version || 1);
      scheduler.reconcileAfterRestart();
      return scheduler;
    }

    snapshot() {
      return clone({ version: this.version, workers: this.workers, audit: this.audit });
    }

    listWorkers() {
      return clone(Object.values(this.workers));
    }

    getWorker(id) {
      const worker = this.workers[id];
      if (!worker) throw new Error("unknown worker: " + id);
      return worker;
    }

    bindConversation(id, identity) {
      if (!identity || typeof identity !== "string") throw new Error("conversation identity is required");
      const worker = this.getWorker(id);
      if (worker.conversationIdentity && worker.conversationIdentity !== identity) {
        throw new Error("conversation identity lock mismatch for " + id);
      }
      worker.conversationIdentity = identity;
      worker.revision++;
      return clone(worker);
    }

    assertConversation(id, identity) {
      const worker = this.getWorker(id);
      if (!worker.conversationIdentity || worker.conversationIdentity !== identity) {
        throw new Error("conversation identity lock mismatch for " + id);
      }
      return true;
    }

    startCycle(id, contract) {
      const worker = this.getWorker(id);
      if ([STATES.PAUSED, STATES.QUARANTINED].includes(worker.state)) {
        throw new Error(id + " is not available for a new cycle");
      }
      if (!contract || !contract.missionId || !contract.cycleId) {
        throw new Error("missionId and cycleId are required");
      }
      validateQueue(contract.queue);
      worker.missionId = String(contract.missionId);
      worker.cycleId = String(contract.cycleId);
      worker.queue = contract.queue.slice();
      worker.currentPass = 0;
      worker.completedPasses = [];
      worker.lastDispatchAt = null;
      worker.health = "ready";
      worker.state = STATES.WAITING_GATE;
      worker.pauseReason = null;
      worker.blockReason = null;
      worker.actionKeys = [];
      worker.nextGateAt = nowFrom(this.clock) + this.initialOffsetMs(worker.id);
      worker.revision++;
      this.record(EVENTS.CYCLE_STARTED, worker, { nextGateAt: worker.nextGateAt });
      return clone(worker);
    }

    initialOffsetMs(id) {
      const worker = this.getWorker(id);
      const position = Number(id.slice(1)) - 1;
      return position * this.staggerStepMs + (worker.squad === "B" ? this.squadBOffsetMs : 0);
    }

    effectiveGateMs(worker) {
      const factor = SLOWDOWN[worker.slowdown] || 1;
      return this.minimumGateMs * factor;
    }

    setSlowdown(id, level) {
      const worker = this.getWorker(id);
      if (!Object.prototype.hasOwnProperty.call(SLOWDOWN, level)) throw new Error("invalid slowdown level");
      worker.slowdown = level;
      worker.revision++;
      return clone(worker);
    }

    markUsageRestricted(id, reason = "usage/restriction") {
      const worker = this.getWorker(id);
      worker.state = STATES.PAUSED;
      worker.pauseReason = reason;
      worker.revision++;
      this.record(EVENTS.BLOCKED, worker, { reason, restriction: true });
      return clone(worker);
    }

    pauseWorker(id, reason = "manual") {
      const worker = this.getWorker(id);
      worker.state = STATES.PAUSED;
      worker.pauseReason = reason;
      worker.revision++;
      return clone(worker);
    }

    resumeWorker(id) {
      const worker = this.getWorker(id);
      if (worker.state !== STATES.PAUSED) return clone(worker);
      worker.pauseReason = null;
      worker.state = worker.currentPass >= 5 ? STATES.CYCLE_COMPLETE : STATES.WAITING_GATE;
      if (worker.state === STATES.WAITING_GATE) {
        worker.nextGateAt = Math.max(nowFrom(this.clock), worker.nextGateAt || 0);
      }
      worker.revision++;
      return clone(worker);
    }

    pauseSquad(squad, reason = "manual") {
      return Object.values(this.workers)
        .filter(worker => worker.squad === squad)
        .map(worker => this.pauseWorker(worker.id, reason));
    }

    resumeSquad(squad) {
      return Object.values(this.workers)
        .filter(worker => worker.squad === squad)
        .map(worker => this.resumeWorker(worker.id));
    }

    quarantine(id, reason = "quarantined") {
      const worker = this.getWorker(id);
      worker.state = STATES.QUARANTINED;
      worker.pauseReason = reason;
      worker.revision++;
      return clone(worker);
    }

    block(id, reason) {
      const worker = this.getWorker(id);
      worker.state = STATES.BLOCKED;
      worker.blockReason = reason || "blocked";
      worker.revision++;
      this.record(EVENTS.BLOCKED, worker, { reason: worker.blockReason });
      return clone(worker);
    }

    inspectGate(id, observation = {}) {
      const worker = this.getWorker(id);
      const now = nowFrom(this.clock);

      if ([STATES.PAUSED, STATES.QUARANTINED, STATES.BLOCKED, STATES.CYCLE_COMPLETE].includes(worker.state)) {
        return { action: "none", reason: worker.state, worker: clone(worker) };
      }
      if (!worker.missionId || !worker.cycleId || worker.queue.length !== 5) {
        return { action: "none", reason: "NO_ACTIVE_CYCLE", worker: clone(worker) };
      }
      if (now < Number(worker.nextGateAt || 0)) {
        return { action: "none", reason: "GATE_NOT_DUE", worker: clone(worker) };
      }
      if (observation.blocked || observation.restricted) {
        if (observation.restricted) {
          this.markUsageRestricted(id, observation.reason || "usage/restriction");
          return { action: "paused", reason: "RESTRICTED", worker: clone(worker) };
        }
        this.block(id, observation.reason || "blocked");
        return { action: "blocked", worker: clone(worker) };
      }
      if (observation.busy) {
        worker.state = STATES.BUSY;
        worker.health = "busy";
        worker.nextGateAt = now + this.effectiveGateMs(worker);
        worker.revision++;
        this.record(EVENTS.WORKER_BUSY, worker, { deferredUntil: worker.nextGateAt });
        return {
          action: "defer",
          reason: "WORKER_BUSY",
          nextGateAt: worker.nextGateAt,
          worker: clone(worker)
        };
      }

      if (worker.currentPass >= 5) {
        worker.state = STATES.CYCLE_COMPLETE;
        worker.nextGateAt = null;
        worker.revision++;
        return { action: "none", reason: STATES.CYCLE_COMPLETE, worker: clone(worker) };
      }

      const passNumber = worker.currentPass + 1;
      const key = actionKey(worker, passNumber);
      if (worker.actionKeys.includes(key)) {
        worker.state = STATES.WAITING_GATE;
        worker.nextGateAt = now + this.effectiveGateMs(worker);
        worker.revision++;
        return { action: "none", reason: "DUPLICATE_SUPPRESSED", key, worker: clone(worker) };
      }

      return {
        action: "dispatch",
        key,
        workerId: id,
        squad: worker.squad,
        missionId: worker.missionId,
        cycleId: worker.cycleId,
        passNumber,
        instruction: worker.queue[passNumber - 1],
        conversationIdentity: worker.conversationIdentity,
        worker: clone(worker)
      };
    }

    confirmDispatch(id, key, dispatchedAt) {
      const worker = this.getWorker(id);
      const expected = actionKey(worker, worker.currentPass + 1);
      if (key !== expected) throw new Error("dispatch key does not match current pass");
      if (worker.actionKeys.includes(key)) return clone(worker);
      worker.actionKeys.push(key);
      if (worker.actionKeys.length > 100) {
        worker.actionKeys.splice(0, worker.actionKeys.length - 100);
      }
      worker.currentPass += 1;
      worker.lastDispatchAt = Number(dispatchedAt == null ? nowFrom(this.clock) : dispatchedAt);
      worker.nextGateAt = null;
      worker.state = STATES.BUSY;
      worker.health = "busy";
      worker.revision++;
      this.record(EVENTS.PASS_DISPATCHED, worker, { passNumber: worker.currentPass, key });
      return clone(worker);
    }

    completePass(id, result) {
      const worker = this.getWorker(id);
      if (worker.currentPass < 1) throw new Error("no dispatched pass to complete");
      const passNumber = worker.currentPass;
      if (worker.completedPasses.some(pass => pass.passNumber === passNumber)) return clone(worker);

      worker.completedPasses.push({
        passNumber,
        result: clone(result == null ? null : result),
        completedAt: nowFrom(this.clock)
      });
      worker.health = "ready";
      this.record(EVENTS.PASS_COMPLETED, worker, { passNumber });

      if (passNumber >= 5) {
        worker.state = STATES.CYCLE_COMPLETE;
        worker.nextGateAt = null;
        worker.revision++;
        this.record(EVENTS.CYCLE_COMPLETE, worker, { completedPasses: worker.completedPasses.length });
        this.record(EVENTS.SUPERVISOR_REVIEW_REQUIRED, worker, {
          missionId: worker.missionId,
          cycleId: worker.cycleId,
          completedPasses: clone(worker.completedPasses)
        });
      } else {
        worker.state = STATES.WAITING_GATE;
        worker.nextGateAt = nowFrom(this.clock) + this.effectiveGateMs(worker);
        worker.revision++;
      }
      return clone(worker);
    }

    reconcileAfterRestart() {
      const now = nowFrom(this.clock);
      for (const worker of Object.values(this.workers)) {
        if (worker.state === STATES.BUSY) {
          worker.state = STATES.WAITING_GATE;
          worker.health = "reconciling";
          worker.nextGateAt = Math.max(
            now + this.effectiveGateMs(worker),
            Number(worker.nextGateAt || 0)
          );
          worker.revision++;
        }
        if (worker.currentPass >= 5 && worker.completedPasses.length >= 5) {
          worker.state = STATES.CYCLE_COMPLETE;
          worker.nextGateAt = null;
        }
      }
      return this.snapshot();
    }

    record(type, worker, detail) {
      const event = {
        type,
        at: nowFrom(this.clock),
        workerId: worker.id,
        squad: worker.squad,
        missionId: worker.missionId,
        cycleId: worker.cycleId,
        detail: clone(detail || {})
      };
      this.audit.push(event);
      if (this.audit.length > this.maxAudit) {
        this.audit.splice(0, this.audit.length - this.maxAudit);
      }
      this.emit(clone(event));
      return event;
    }
  }

  return { STATES, EVENTS, DEFAULT_GATE_MS, ChatFivePassScheduler };
});
