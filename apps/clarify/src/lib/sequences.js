// ─── Sequence engine core — pure decision logic ──────────────────────────────
// No I/O in this file: everything takes plain data in and returns a decision
// out, so the whole branching model is unit-testable. The loop that talks to
// Supabase/Claude lives in useSequenceEngine (engineLoop.js); the ONLY thing
// the loop ever does with a decision is draft a message into the approval
// queue or move a pointer after a HUMAN-approved send. The engine never sends.
//
// Model (PLAN.md AD-3): a sequence is an ordered ladder of steps. Each step
// has wait_days (measured from the previous outbound send in the thread) and
// a send_condition gate evaluated when the step comes due:
//
//   always          → draft it no matter what
//   no_reply        → draft only if the prospect hasn't replied
//   no_open         → draft only if the last send has no open event*
//   opened_no_reply → draft only if last send was opened AND no reply yet
//   clicked         → draft only if any link in the thread was clicked
//   not_clicked     → draft only if no link in the thread was clicked
//
// A failed gate SKIPS the step (pointer advances) and the next step is
// evaluated immediately against its own wait clock. Replies stop the whole
// enrollment when sequence.stop_on_reply (default true).
//
// * Open tracking is dormant while sends are text/plain (AD-4). openTrackingLive
//   below is the single switch; while false, open-based gates degrade
//   deterministically: no_open → no_reply, opened_no_reply → no_reply.

export const OPEN_TRACKING_LIVE = false; // flips when sends go HTML (see PLAN.md)

export const GATE_LABELS = {
  always: "Always send",
  no_reply: "If no reply",
  no_open: "If not opened",
  opened_no_reply: "If opened but no reply",
  clicked: "If a link was clicked",
  not_clicked: "If no link clicked",
};

// What a gate actually evaluates as while opens are dormant.
export function effectiveGate(condition, openTrackingLive = OPEN_TRACKING_LIVE) {
  if (openTrackingLive) return condition;
  if (condition === "no_open" || condition === "opened_no_reply") return "no_reply";
  return condition;
}

// ── Thread signal extraction ──────────────────────────────────────────────────
// messages: rows for ONE outreach thread (any order). events: email_events rows
// for those messages. Returns the signals gates care about.
export function threadSignals(messages = [], events = []) {
  const outbound = messages
    .filter((m) => m.direction === "outbound" && m.status === "sent" && m.sent_at)
    .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
  const lastOutbound = outbound[outbound.length - 1] || null;
  const inbound = messages
    .filter((m) => m.direction === "inbound")
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const lastInbound = inbound[inbound.length - 1] || null;
  const repliedAfterLastSend = !!(
    lastInbound && lastOutbound &&
    new Date(lastInbound.created_at) >= new Date(lastOutbound.sent_at)
  );
  const eventsFor = (msgId) => events.filter((e) => e.message_id === msgId);
  const lastSendOpened = !!(lastOutbound && eventsFor(lastOutbound.id).some((e) => e.event_type === "open"));
  const anyClick = events.some((e) => e.event_type === "click");
  return {
    outboundCount: outbound.length,
    lastOutbound,
    lastSentAt: lastOutbound ? new Date(lastOutbound.sent_at) : null,
    hasReply: inbound.length > 0,
    repliedAfterLastSend,
    lastSendOpened,
    anyClick,
  };
}

// ── Gate evaluation ───────────────────────────────────────────────────────────
export function gatePasses(condition, signals, openTrackingLive = OPEN_TRACKING_LIVE) {
  switch (effectiveGate(condition, openTrackingLive)) {
    case "always":          return true;
    case "no_reply":        return !signals.hasReply;
    case "no_open":         return !signals.lastSendOpened;
    case "opened_no_reply": return signals.lastSendOpened && !signals.hasReply;
    case "clicked":         return signals.anyClick;
    case "not_clicked":     return !signals.anyClick;
    default:                return false;
  }
}

// ── Step pointer ──────────────────────────────────────────────────────────────
// The pointer ("last handled step") is DERIVED, not trusted: the stored
// enrollment.current_step_order only records skips, while actual sends live in
// the ledger. Deriving max(stored, highest SENT step) makes the engine
// self-healing — a step approved & sent from the Queue advances the ladder
// even if nothing remembered to bump the stored pointer (that forgetfulness
// previously made the engine redraft step 1 forever).
export function effectiveStepPointer(enrollment, steps = [], messages = []) {
  const byId = new Map(steps.map((s) => [s.id, s.step_order]));
  let max = enrollment?.current_step_order || 0;
  for (const m of messages || []) {
    if (m.direction !== "outbound" || m.status !== "sent" || !m.step_id) continue;
    const order = byId.get(m.step_id);
    if (typeof order === "number" && order > max) max = order;
  }
  return max;
}

// ── The decision ──────────────────────────────────────────────────────────────
// enrollment: { current_step_order, status }
// sequence:   { stop_on_reply }
// steps:      ordered ASC by step_order (step_order starts at 1; 0 = the
//             initial send that happened at/never before enrollment)
// Returns one of:
//   { action: "stop",     reason }                      → mark stopped_reply
//   { action: "complete", reason }                      → mark completed
//   { action: "wait",     until: Date, reason }         → set next_action_at
//   { action: "skip",     step, reason }                → advance pointer past step, re-decide
//   { action: "draft",    step, dueSince: Date, reason }→ draft into approval queue
//   { action: "none",     reason }                      → paused/invalid, do nothing
export function decideNextAction({ enrollment, sequence, steps, messages, events, now = new Date(), openTrackingLive = OPEN_TRACKING_LIVE }) {
  if (!enrollment || enrollment.status !== "active") {
    return { action: "none", reason: `enrollment ${enrollment ? enrollment.status : "missing"}` };
  }
  const signals = threadSignals(messages, events);

  if (signals.hasReply && sequence?.stop_on_reply !== false) {
    return { action: "stop", reason: "prospect replied — sequence stops, human takes over" };
  }
  if (!signals.lastSentAt) {
    // Enrolled but nothing sent yet: the initial send is still a human action.
    return { action: "wait", until: null, reason: "waiting for the initial send" };
  }

  const pointer = effectiveStepPointer(enrollment, steps, messages);
  const nextStep = (steps || []).find((s) => s.step_order === pointer + 1);
  if (!nextStep) {
    return { action: "complete", reason: "no steps left — cadence exhausted" };
  }

  const dueAt = new Date(signals.lastSentAt.getTime() + nextStep.wait_days * 86400000);
  if (now < dueAt) {
    return { action: "wait", until: dueAt, reason: `${nextStep.name} due ${dueAt.toISOString().slice(0, 10)}` };
  }
  if (!gatePasses(nextStep.send_condition, signals, openTrackingLive)) {
    return {
      action: "skip",
      step: nextStep,
      reason: `${nextStep.name} gate "${effectiveGate(nextStep.send_condition, openTrackingLive)}" not met`,
    };
  }
  // A draft for this step already waiting on approval? Don't double-draft.
  const pendingForStep = (messages || []).some(
    (m) => m.direction === "outbound" && m.status === "draft" && m.step_id === nextStep.id
  );
  if (pendingForStep) {
    return { action: "wait", until: null, reason: `${nextStep.name} draft already in the approval queue` };
  }
  return { action: "draft", step: nextStep, dueSince: dueAt, reason: `${nextStep.name} due — drafting for approval` };
}

// Run decide → apply skips locally → return the first non-skip decision plus
// the pointer the enrollment should hold afterward. Pure; the loop persists.
export function resolveDecision(args) {
  let pointer = effectiveStepPointer(args.enrollment, args.steps, args.messages);
  let guard = 0;
  let decision = decideNextAction(args);
  while (decision.action === "skip" && guard < 50) {
    guard++;
    pointer = decision.step.step_order;
    decision = decideNextAction({ ...args, enrollment: { ...args.enrollment, current_step_order: pointer } });
  }
  return { decision, pointer };
}

// ── Template merge ────────────────────────────────────────────────────────────
// {{business_name}} {{first_name}} {{city}} {{category}} {{website}} — anything
// unknown is left intact so the human sees it and fixes it in review.
export function mergeTemplate(template, card) {
  if (!template) return "";
  const first = (card?.contact?.name || "").trim().split(/\s+/)[0] || "";
  const vars = {
    business_name: card?.prospect?.business_name || "",
    first_name: first,
    city: card?.prospect?.city || "",
    category: card?.prospect?.category || "",
    website: card?.prospect?.website || "",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars && vars[key] ? vars[key] : m));
}
