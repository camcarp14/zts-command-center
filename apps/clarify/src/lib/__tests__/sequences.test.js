import { describe, it, expect } from "vitest";
import {
  decideNextAction,
  resolveDecision,
  threadSignals,
  gatePasses,
  effectiveGate,
  mergeTemplate,
} from "../sequences";

// ── fixtures ──────────────────────────────────────────────────────────────────
const DAY = 86400000;
const t0 = new Date("2026-07-01T15:00:00Z");
const at = (days) => new Date(t0.getTime() + days * DAY);

const seq = { id: "seq1", stop_on_reply: true };
const steps = [
  { id: "s1", step_order: 1, name: "Bump", wait_days: 3, send_condition: "no_reply" },
  { id: "s2", step_order: 2, name: "Value-add", wait_days: 4, send_condition: "no_reply" },
  { id: "s3", step_order: 3, name: "Break-up", wait_days: 7, send_condition: "always" },
];
const enr = (over = {}) => ({ id: "e1", current_step_order: 0, status: "active", ...over });
const sent = (id, when, extra = {}) => ({
  id, direction: "outbound", status: "sent", sent_at: when.toISOString(), ...extra,
});
const inboundMsg = (id, when) => ({ id, direction: "inbound", status: "received", created_at: when.toISOString() });
const draft = (id, stepId) => ({ id, direction: "outbound", status: "draft", step_id: stepId });

// ── threadSignals ────────────────────────────────────────────────────────────
describe("threadSignals", () => {
  it("finds the last outbound send and reply state", () => {
    const s = threadSignals(
      [sent("m1", t0), sent("m2", at(3)), inboundMsg("m3", at(4))],
      []
    );
    expect(s.outboundCount).toBe(2);
    expect(s.lastSentAt.toISOString()).toBe(at(3).toISOString());
    expect(s.hasReply).toBe(true);
    expect(s.repliedAfterLastSend).toBe(true);
  });
  it("ignores drafts when computing sends", () => {
    const s = threadSignals([sent("m1", t0), draft("m2", "s1")], []);
    expect(s.outboundCount).toBe(1);
  });
  it("detects opens on the LAST send only, clicks anywhere", () => {
    const events = [
      { message_id: "m1", event_type: "open" },
      { message_id: "m1", event_type: "click" },
    ];
    const s = threadSignals([sent("m1", t0), sent("m2", at(3))], events);
    expect(s.lastSendOpened).toBe(false); // open was on m1, last send is m2
    expect(s.anyClick).toBe(true);
  });
});

// ── gates ────────────────────────────────────────────────────────────────────
describe("gates", () => {
  const base = { hasReply: false, lastSendOpened: false, anyClick: false };
  it("no_reply passes without a reply, fails with one", () => {
    expect(gatePasses("no_reply", base)).toBe(true);
    expect(gatePasses("no_reply", { ...base, hasReply: true })).toBe(false);
  });
  it("open-based gates degrade to no_reply while opens are dormant", () => {
    expect(effectiveGate("no_open", false)).toBe("no_reply");
    expect(effectiveGate("opened_no_reply", false)).toBe("no_reply");
    expect(effectiveGate("no_open", true)).toBe("no_open");
    // dormant mode: passes purely on reply-absence even though never opened
    expect(gatePasses("opened_no_reply", base, false)).toBe(true);
    // live mode: needs the actual open
    expect(gatePasses("opened_no_reply", base, true)).toBe(false);
    expect(gatePasses("opened_no_reply", { ...base, lastSendOpened: true }, true)).toBe(true);
  });
  it("click gates work both directions", () => {
    expect(gatePasses("clicked", base)).toBe(false);
    expect(gatePasses("clicked", { ...base, anyClick: true })).toBe(true);
    expect(gatePasses("not_clicked", base)).toBe(true);
  });
});

// ── decideNextAction ─────────────────────────────────────────────────────────
describe("decideNextAction", () => {
  it("waits for the human initial send when nothing is sent yet", () => {
    const d = decideNextAction({ enrollment: enr(), sequence: seq, steps, messages: [], events: [], now: at(0) });
    expect(d.action).toBe("wait");
    expect(d.reason).toMatch(/initial send/);
  });

  it("waits until the step's due date", () => {
    const d = decideNextAction({ enrollment: enr(), sequence: seq, steps, messages: [sent("m1", t0)], events: [], now: at(2) });
    expect(d.action).toBe("wait");
    expect(d.until.toISOString()).toBe(at(3).toISOString());
  });

  it("drafts the Bump once due with no reply — and never sends", () => {
    const d = decideNextAction({ enrollment: enr(), sequence: seq, steps, messages: [sent("m1", t0)], events: [], now: at(3.5) });
    expect(d.action).toBe("draft");
    expect(d.step.name).toBe("Bump");
  });

  it("stops on reply when stop_on_reply", () => {
    const d = decideNextAction({
      enrollment: enr(), sequence: seq, steps,
      messages: [sent("m1", t0), inboundMsg("m2", at(1))], events: [], now: at(3.5),
    });
    expect(d.action).toBe("stop");
  });

  it("keeps going past a reply when stop_on_reply=false (gates still see it)", () => {
    const d = decideNextAction({
      enrollment: enr(), sequence: { ...seq, stop_on_reply: false }, steps,
      messages: [sent("m1", t0), inboundMsg("m2", at(1))], events: [], now: at(3.5),
    });
    // Bump's no_reply gate fails → skip
    expect(d.action).toBe("skip");
    expect(d.step.name).toBe("Bump");
  });

  it("does not double-draft a step already in the approval queue", () => {
    const d = decideNextAction({
      enrollment: enr(), sequence: seq, steps,
      messages: [sent("m1", t0), draft("d1", "s1")], events: [], now: at(4),
    });
    expect(d.action).toBe("wait");
    expect(d.reason).toMatch(/approval queue/);
  });

  it("completes when the ladder is exhausted", () => {
    const d = decideNextAction({
      enrollment: enr({ current_step_order: 3 }), sequence: seq, steps,
      messages: [sent("m1", t0)], events: [], now: at(30),
    });
    expect(d.action).toBe("complete");
  });

  it("advances past a step once its message is SENT, even when the stored pointer never moved", () => {
    // Regression: queue-approved sends used to leave current_step_order at 0,
    // so the engine redrafted Bump forever and never reached Value-add.
    const msgs = [sent("m1", t0), sent("m2", at(4), { step_id: "s1" })];
    const d = decideNextAction({ enrollment: enr(), sequence: seq, steps, messages: msgs, events: [], now: at(6) });
    expect(d.action).toBe("wait");
    expect(d.reason).toMatch(/Value-add/);
    const d2 = decideNextAction({ enrollment: enr(), sequence: seq, steps, messages: msgs, events: [], now: at(8.2) });
    expect(d2.action).toBe("draft");
    expect(d2.step.name).toBe("Value-add");
    const { pointer } = resolveDecision({ enrollment: enr(), sequence: seq, steps, messages: msgs, events: [], now: at(6) });
    expect(pointer).toBe(1);
  });

  it("measures each step from the LAST send, not enrollment", () => {
    // initial at t0, Bump sent at day 5 → Value-add (wait 4) due day 9
    const msgs = [sent("m1", t0), sent("m2", at(5), { step_id: "s1" })];
    const d1 = decideNextAction({ enrollment: enr({ current_step_order: 1 }), sequence: seq, steps, messages: msgs, events: [], now: at(8) });
    expect(d1.action).toBe("wait");
    const d2 = decideNextAction({ enrollment: enr({ current_step_order: 1 }), sequence: seq, steps, messages: msgs, events: [], now: at(9.1) });
    expect(d2.action).toBe("draft");
    expect(d2.step.name).toBe("Value-add");
  });
});

// ── resolveDecision (skip-chains) ────────────────────────────────────────────
describe("resolveDecision", () => {
  it("skips a failed clicked-gate step and lands on the next due step", () => {
    const clickSteps = [
      { id: "s1", step_order: 1, name: "Clicked-only nudge", wait_days: 2, send_condition: "clicked" },
      { id: "s2", step_order: 2, name: "Fallback", wait_days: 0, send_condition: "always" },
    ];
    const { decision, pointer } = resolveDecision({
      enrollment: enr(), sequence: seq, steps: clickSteps,
      messages: [sent("m1", t0)], events: [], now: at(2.5),
    });
    // s1 gate fails (never clicked) → skip → s2 wait_days 0 from last send → draft now
    expect(pointer).toBe(1);
    expect(decision.action).toBe("draft");
    expect(decision.step.name).toBe("Fallback");
  });

  it("branches to the click path when a click exists", () => {
    const clickSteps = [
      { id: "s1", step_order: 1, name: "Clicked-only nudge", wait_days: 2, send_condition: "clicked" },
      { id: "s2", step_order: 2, name: "Fallback", wait_days: 0, send_condition: "not_clicked" },
    ];
    const { decision } = resolveDecision({
      enrollment: enr(), sequence: seq, steps: clickSteps,
      messages: [sent("m1", t0)], events: [{ message_id: "m1", event_type: "click" }], now: at(2.5),
    });
    expect(decision.action).toBe("draft");
    expect(decision.step.name).toBe("Clicked-only nudge");
  });

  it("completes via skips when every remaining gate fails", () => {
    const failing = [
      { id: "s1", step_order: 1, name: "A", wait_days: 1, send_condition: "clicked" },
      { id: "s2", step_order: 2, name: "B", wait_days: 1, send_condition: "clicked" },
    ];
    const { decision, pointer } = resolveDecision({
      enrollment: enr(), sequence: seq, steps: failing,
      messages: [sent("m1", t0)], events: [], now: at(10),
    });
    expect(pointer).toBe(2);
    expect(decision.action).toBe("complete");
  });

  it("never acts on paused enrollments", () => {
    const { decision } = resolveDecision({
      enrollment: enr({ status: "paused" }), sequence: seq, steps,
      messages: [sent("m1", t0)], events: [], now: at(10),
    });
    expect(decision.action).toBe("none");
  });
});

// ── mergeTemplate ────────────────────────────────────────────────────────────
describe("mergeTemplate", () => {
  const card = {
    prospect: { business_name: "Lakeview Dental", city: "Chicago", category: "dentist", website: "https://lakeview.example" },
    contact: { name: "Dana Whitfield" },
  };
  it("merges known vars", () => {
    expect(mergeTemplate("Hi {{first_name}} at {{business_name}} in {{city}}", card))
      .toBe("Hi Dana at Lakeview Dental in Chicago");
  });
  it("leaves unknown or empty vars visible for human review", () => {
    expect(mergeTemplate("{{nonsense}} and {{first_name}}", { prospect: {}, contact: {} }))
      .toBe("{{nonsense}} and {{first_name}}");
  });
});
