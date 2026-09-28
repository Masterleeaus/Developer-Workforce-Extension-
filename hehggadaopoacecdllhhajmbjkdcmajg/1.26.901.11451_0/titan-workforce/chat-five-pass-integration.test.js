"use strict";

const assert = require("assert");
const {
  STATES,
  DEFAULT_GATE_MS,
  ChatFivePassScheduler
} = require("./chat-five-pass-scheduler.js");
const {
  GuardedChatFivePassScheduler,
  migrateLegacyFiveByFive
} = require("./chat-five-pass-integration.js");

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    set: value => { t = value; }
  };
}

function queue(prefix) {
  return [1, 2, 3, 4, 5].map(n => prefix + " pass " + n);
}

(function testFairnessAcrossAllTenWorkers() {
  const clock = fakeClock(0);
  const scheduler = new ChatFivePassScheduler({ clock: clock.now });
  const dispatched = [];

  for (const worker of scheduler.listWorkers()) {
    scheduler.startCycle(worker.id, {
      missionId: "mission-" + worker.id,
      cycleId: "cycle-1",
      queue: queue(worker.id)
    });
  }

  for (let pass = 1; pass <= 5; pass++) {
    for (const worker of scheduler.listWorkers()) {
      clock.set(scheduler.getWorker(worker.id).nextGateAt);
      const action = scheduler.inspectGate(worker.id, { busy: false });
      assert.strictEqual(action.action, "dispatch", worker.id + " should dispatch");
      assert.strictEqual(action.passNumber, pass);
      dispatched.push(worker.id + ":" + pass);
      scheduler.confirmDispatch(worker.id, action.key);
      scheduler.completePass(worker.id, { pass });
    }
  }

  const counts = Object.fromEntries(
    scheduler.listWorkers().map(worker => [
      worker.id,
      dispatched.filter(value => value.startsWith(worker.id + ":")).length
    ])
  );

  assert(Object.values(counts).every(count => count === 5));
  assert(
    scheduler.listWorkers().every(worker => worker.state === STATES.CYCLE_COMPLETE)
  );
})();

(function testBusyWorkerNeverInterruptedAcrossRepeatedGates() {
  const clock = fakeClock(0);
  const scheduler = new ChatFivePassScheduler({ clock: clock.now });
  scheduler.startCycle("A3", {
    missionId: "m",
    cycleId: "c",
    queue: queue("A3")
  });

  for (let n = 0; n < 3; n++) {
    clock.set(scheduler.getWorker("A3").nextGateAt);
    const beforePass = scheduler.getWorker("A3").currentPass;
    const result = scheduler.inspectGate("A3", { busy: true });
    assert.strictEqual(result.action, "defer");
    assert.strictEqual(scheduler.getWorker("A3").currentPass, beforePass);
    assert.strictEqual(
      result.nextGateAt,
      clock.now() + DEFAULT_GATE_MS
    );
  }
})();

(function testGuardBlocksBudgetOrAntiLoopViolation() {
  const clock = fakeClock(0);
  const scheduler = new GuardedChatFivePassScheduler({
    clock: clock.now,
    advanceGuard: worker => ({
      allowed: worker.currentPass < 2,
      reason: "ANTI_LOOP_BUDGET_EXHAUSTED"
    })
  });

  scheduler.startCycle("B1", {
    missionId: "m",
    cycleId: "c",
    queue: queue("B1")
  });

  for (let pass = 1; pass <= 2; pass++) {
    clock.set(scheduler.getWorker("B1").nextGateAt);
    const action = scheduler.inspectGate("B1", { busy: false });
    assert.strictEqual(action.action, "dispatch");
    scheduler.confirmDispatch("B1", action.key);
    scheduler.completePass("B1", { pass });
  }

  clock.set(scheduler.getWorker("B1").nextGateAt);
  const blocked = scheduler.inspectGate("B1", { busy: false });
  assert.strictEqual(blocked.action, "blocked");
  assert.strictEqual(blocked.reason, "ANTI_LOOP_BUDGET_EXHAUSTED");
  assert.strictEqual(scheduler.getWorker("B1").state, STATES.BLOCKED);
})();

(function testLegacyMigrationMapsWWorkersToSquadAOnly() {
  const migrated = migrateLegacyFiveByFive({
    workers: {
      W1: {
        conversationId: "legacy-conv",
        missionId: "legacy-mission",
        cycleId: "legacy-cycle",
        passCount: 2,
        queue: queue("legacy")
      }
    },
    auditLog: [{ type: "legacy" }]
  });

  assert.strictEqual(migrated.workers.A1.conversationIdentity, "legacy-conv");
  assert.strictEqual(migrated.workers.A1.missionId, "legacy-mission");
  assert.strictEqual(migrated.workers.A1.currentPass, 2);
  assert.strictEqual(migrated.workers.B1.missionId, null);
  assert.strictEqual(migrated.migration.mapped, "W1-W5 -> A1-A5");
  assert.strictEqual(migrated.audit.length, 1);
})();

(function testRestoreKeepsGuardedClass() {
  const clock = fakeClock(0);
  const original = new GuardedChatFivePassScheduler({
    clock: clock.now,
    advanceGuard: () => true
  });
  original.startCycle("A1", {
    missionId: "m",
    cycleId: "c",
    queue: queue("A1")
  });

  const restored = GuardedChatFivePassScheduler.restore(original.snapshot(), {
    clock: clock.now,
    advanceGuard: () => false
  });

  clock.set(restored.getWorker("A1").nextGateAt);
  const result = restored.inspectGate("A1", { busy: false });
  assert.strictEqual(result.action, "blocked");
})();

console.log("Titan Chat Five-Pass integration tests passed");
