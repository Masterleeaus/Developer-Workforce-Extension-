"use strict";

const assert = require("assert");
const {
  STATES,
  DEFAULT_GATE_MS,
  ChatFivePassScheduler
} = require("./chat-five-pass-scheduler.js");

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: ms => {
      t += ms;
      return t;
    },
    set: value => {
      t = value;
      return t;
    }
  };
}

function queue(prefix) {
  return [1, 2, 3, 4, 5].map(n => prefix + " pass " + n);
}

(function testTenWorkerRosterAndStaggering() {
  const clock = fakeClock(1000);
  const scheduler = new ChatFivePassScheduler({ clock: clock.now });
  assert.deepStrictEqual(
    scheduler.listWorkers().map(worker => worker.id),
    ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5"]
  );

  scheduler.startCycle("A1", { missionId: "m", cycleId: "c", queue: queue("A1") });
  scheduler.startCycle("A2", { missionId: "m", cycleId: "c", queue: queue("A2") });
  scheduler.startCycle("B1", { missionId: "m", cycleId: "c", queue: queue("B1") });

  assert(scheduler.getWorker("A1").nextGateAt < scheduler.getWorker("A2").nextGateAt);
  assert(scheduler.getWorker("A1").nextGateAt < scheduler.getWorker("B1").nextGateAt);
})();

(function testBusyGateDefersExactlyOneInterval() {
  const clock = fakeClock(0);
  const scheduler = new ChatFivePassScheduler({ clock: clock.now });
  scheduler.startCycle("A1", { missionId: "m1", cycleId: "c1", queue: queue("q") });
  clock.set(scheduler.getWorker("A1").nextGateAt);
  const before = clock.now();

  const result = scheduler.inspectGate("A1", { busy: true });
  assert.strictEqual(result.action, "defer");
  assert.strictEqual(result.nextGateAt, before + DEFAULT_GATE_MS);
})();

(function testSpecificInstructionAndIdempotencyKey() {
  const clock = fakeClock(0);
  const scheduler = new ChatFivePassScheduler({ clock: clock.now });
  scheduler.bindConversation("A1", "conv-1");
  scheduler.startCycle("A1", {
    missionId: "mission",
    cycleId: "cycle",
    queue: queue("specific")
  });
  clock.set(scheduler.getWorker("A1").nextGateAt);

  const result = scheduler.inspectGate("A1", { busy: false });
  assert.strictEqual(result.action, "dispatch");
  assert.strictEqual(result.instruction, "specific pass 1");
  assert.strictEqual(result.key, "mission/cycle/A1/1");
  assert.strictEqual(result.conversationIdentity, "conv-1");

  scheduler.confirmDispatch("A1", result.key);
  assert.throws(
    () => scheduler.confirmDispatch("A1", result.key),
    /dispatch key does not match current pass/
  );
})();

(function testFivePassCycleAndSupervisorReviewEvent() {
  const clock = fakeClock(0);
  const events = [];
  const scheduler = new ChatFivePassScheduler({
    clock: clock.now,
    emit: event => events.push(event)
  });

  scheduler.startCycle("B3", { missionId: "m2", cycleId: "c2", queue: queue("B3") });

  for (let pass = 1; pass <= 5; pass++) {
    clock.set(scheduler.getWorker("B3").nextGateAt);
    const dispatch = scheduler.inspectGate("B3", { busy: false });
    assert.strictEqual(dispatch.action, "dispatch");
    assert.strictEqual(dispatch.passNumber, pass);
    scheduler.confirmDispatch("B3", dispatch.key);
    scheduler.completePass("B3", { ok: true, pass });
  }

  assert.strictEqual(scheduler.getWorker("B3").state, STATES.CYCLE_COMPLETE);
  assert.strictEqual(scheduler.getWorker("B3").completedPasses.length, 5);
  assert(events.some(event => event.type === "cycle_complete"));
  assert(events.some(event => event.type === "supervisor_review_required"));
})();

(function testSlowdownNeverAcceleratesBelowFiveMinutes() {
  const clock = fakeClock(0);
  const scheduler = new ChatFivePassScheduler({
    clock: clock.now,
    minimumGateMs: 1000
  });

  assert.strictEqual(scheduler.minimumGateMs, DEFAULT_GATE_MS);

  scheduler.setSlowdown("A1", "moderate");
  assert.strictEqual(
    scheduler.effectiveGateMs(scheduler.getWorker("A1")),
    DEFAULT_GATE_MS * 2
  );

  scheduler.setSlowdown("A1", "high");
  assert.strictEqual(
    scheduler.effectiveGateMs(scheduler.getWorker("A1")),
    DEFAULT_GATE_MS * 3
  );
})();

(function testRestrictionPauseAndQuarantine() {
  const scheduler = new ChatFivePassScheduler();
  scheduler.startCycle("B2", { missionId: "m", cycleId: "c", queue: queue("B2") });
  scheduler.markUsageRestricted("B2");
  assert.strictEqual(scheduler.getWorker("B2").state, STATES.PAUSED);

  scheduler.quarantine("A5", "identity-risk");
  assert.strictEqual(scheduler.getWorker("A5").state, STATES.QUARANTINED);
})();

(function testRestartReconciliationDefersInflightWorker() {
  const clock = fakeClock(0);
  const scheduler = new ChatFivePassScheduler({ clock: clock.now });
  scheduler.startCycle("A4", { missionId: "m", cycleId: "c", queue: queue("x") });
  clock.set(scheduler.getWorker("A4").nextGateAt);

  const dispatch = scheduler.inspectGate("A4", { busy: false });
  scheduler.confirmDispatch("A4", dispatch.key);

  const restored = ChatFivePassScheduler.restore(scheduler.snapshot(), {
    clock: clock.now
  });

  assert.strictEqual(restored.getWorker("A4").state, STATES.WAITING_GATE);
  assert(
    restored.getWorker("A4").nextGateAt >= clock.now() + DEFAULT_GATE_MS
  );
})();

(function testConversationIdentityFailsClosed() {
  const scheduler = new ChatFivePassScheduler();
  scheduler.bindConversation("B5", "conv-5");
  assert.throws(
    () => scheduler.bindConversation("B5", "other"),
    /identity lock mismatch/
  );
  assert.throws(
    () => scheduler.assertConversation("B5", "other"),
    /identity lock mismatch/
  );
})();

(function testSquadPauseResume() {
  const scheduler = new ChatFivePassScheduler();
  for (let n = 1; n <= 5; n++) {
    scheduler.startCycle("A" + n, {
      missionId: "m" + n,
      cycleId: "c" + n,
      queue: queue("A" + n)
    });
  }
  scheduler.pauseSquad("A", "maintenance");
  assert(
    scheduler.listWorkers()
      .filter(worker => worker.squad === "A")
      .every(worker => worker.state === STATES.PAUSED)
  );
  scheduler.resumeSquad("A");
  assert(
    scheduler.listWorkers()
      .filter(worker => worker.squad === "A")
      .every(worker => worker.state === STATES.WAITING_GATE)
  );
})();

console.log("Titan Chat Five-Pass Scheduler tests passed");
