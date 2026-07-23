import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  WORKER_DEFAULTS, wk, worklog, suggestions,
  inShift, proposeTasks, workerSpendThisHour, workerTaskSpendThisHour,
} from "../dnaWorker.js";
import { removeNode, seedGenome, updateNode } from "../dna.js";

// ── localStorage shim ─────────────────────────────────────────────────────────
// Same stand-in dna.test.js uses: store.js swallows a missing localStorage, so
// without this every wk.get() would read defaults and every add() would vanish.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
};
beforeEach(() => mem.clear());

// ── fixtures ──────────────────────────────────────────────────────────────────
// Local-time clock for inShift (it reads getHours/getMinutes, not UTC).
const at = (h, m = 0) => new Date(2026, 6, 15, h, m);

// Minimal outreach card; tests override only what they're about.
const card = (over = {}) => ({
  id: "c1", status: "prospected",
  draft_subject: null, draft_body: null,
  reply_body: null, reply_classification: null, reply_draft: null,
  sent_at: null, followups: [],
  contact: { email: "owner@biz.example" },
  prospect: { business_name: "Biz", category: "hvac contractor", ads_detected: false },
  ...over,
});

const ALL_ON = { draft: true, enrich: true, classify: true, followup: true, strategy: true, grow: true };
const opts = (over = {}) => ({ taskTypes: { ...ALL_ON }, enrollments: [], messages: [], ...over });
const G = seedGenome(); // deterministic, all skills awake
const kinds = (tasks, kind) => tasks.filter(t => t.kind === kind);

// ── inShift ───────────────────────────────────────────────────────────────────
describe("inShift", () => {
  it("covers a same-day window with start inclusive, end exclusive", () => {
    const shift = { start: "18:00", end: "23:00" };
    expect(inShift(shift, at(19))).toBe(true);
    expect(inShift(shift, at(18, 0))).toBe(true);   // starts AT 18:00
    expect(inShift(shift, at(22, 59))).toBe(true);
    expect(inShift(shift, at(23, 0))).toBe(false);  // stops AT 23:00
    expect(inShift(shift, at(17, 59))).toBe(false);
    expect(inShift(shift, at(9))).toBe(false);
  });

  it("wraps midnight when start > end (the 22:00→02:00 night shift)", () => {
    const shift = { start: "22:00", end: "02:00" };
    expect(inShift(shift, at(23))).toBe(true);
    expect(inShift(shift, at(0, 30))).toBe(true);
    expect(inShift(shift, at(1, 59))).toBe(true);
    expect(inShift(shift, at(22, 0))).toBe(true);   // boundary semantics survive the wrap
    expect(inShift(shift, at(2, 0))).toBe(false);
    expect(inShift(shift, at(12))).toBe(false);
    expect(inShift(shift, at(21, 59))).toBe(false);
  });

  it("fails closed on zero-length windows and malformed times", () => {
    expect(inShift({ start: "18:00", end: "18:00" }, at(18))).toBe(false); // zero-length ≠ 24h
    expect(inShift({ start: "6pm", end: "23:00" }, at(19))).toBe(false);
    expect(inShift({ start: "18:00", end: "24:01" }, at(19))).toBe(false); // hour 24 is not a time
    expect(inShift({}, at(19))).toBe(false);
    expect(inShift(null, at(19))).toBe(false);
  });
});

// ── wk control object ─────────────────────────────────────────────────────────
describe("wk", () => {
  it("deep-merges nested defaults so a partial stored patch never wipes siblings", () => {
    // Simulate an older/partial write straight into storage.
    localStorage.setItem("sm_dna_worker_ctrl", JSON.stringify({ taskTypes: { draft: false }, eveningShift: { enabled: true } }));
    const c = wk.get();
    expect(c.taskTypes.draft).toBe(false);
    expect(c.taskTypes.classify).toBe(true);          // sibling survives
    expect(c.eveningShift.enabled).toBe(true);
    expect(c.eveningShift.start).toBe("18:00");       // default start survives
    expect(c.cadenceSec).toBe(WORKER_DEFAULTS.cadenceSec);
  });

  it("set patches and setTask flips exactly one task type", () => {
    wk.set({ cadenceSec: 10, running: true });
    expect(wk.get().cadenceSec).toBe(10);
    expect(wk.get().running).toBe(true);
    wk.setTask("enrich", true);
    expect(wk.get().taskTypes.enrich).toBe(true);
    expect(wk.get().taskTypes.draft).toBe(true);      // untouched
    expect(wk.get().cadenceSec).toBe(10);             // earlier patch intact
  });
});

// ── worklog + suggestions stores ──────────────────────────────────────────────
describe("worklog", () => {
  it("stamps id/ts, keeps newest first, and caps at 300", () => {
    for (let i = 0; i < 305; i++) worklog.add({ kind: "draft", title: `t${i}`, status: "done", dedupKey: `d${i}` });
    const all = worklog.all();
    expect(all).toHaveLength(300);
    expect(all[0].title).toBe("t304");                // newest first
    expect(all[0].id).toBeTruthy();
    expect(all[0].ts).toBeTruthy();
    expect(all.some(e => e.title === "t0")).toBe(false); // oldest fell off
    worklog.clear();
    expect(worklog.all()).toEqual([]);
  });
});

describe("suggestions", () => {
  it("adds with dedup by dedupKey and resolves accept/dismiss", () => {
    const s1 = suggestions.add({ label: "Med spa converts", region: "knowledge", text: "x", dedupKey: "kb_vertical_rates" });
    expect(s1.resolved).toBe(false);
    expect(suggestions.add({ label: "dupe", region: "knowledge", text: "y", dedupKey: "kb_vertical_rates" })).toBeNull();
    expect(suggestions.all()).toHaveLength(1);
    suggestions.resolve(s1.id, true);
    expect(suggestions.all()[0]).toMatchObject({ resolved: true, accepted: true });
    const s2 = suggestions.add({ label: "Other", region: "knowledge", text: "z", dedupKey: "kb_other" });
    suggestions.resolve(s2.id, false);
    expect(suggestions.all().find(x => x.id === s2.id)).toMatchObject({ resolved: true, accepted: false });
  });
});

// ── workerSpendThisHour ───────────────────────────────────────────────────────
describe("workerSpendThisHour", () => {
  it("sums only dna_-prefixed obs entries from the last hour", () => {
    const now = Date.now();
    localStorage.setItem("sm_obs_log", JSON.stringify([
      { fn: "dna_strategy", ts: new Date(now - 10 * 60000).toISOString(), costEstimate: 0.02 },
      { fn: "dna_pulse", ts: new Date(now - 30 * 60000).toISOString(), costEstimate: 0.01 },
      { fn: "dna_pulse", ts: new Date(now - 2 * 3600000).toISOString(), costEstimate: 0.5 },   // too old
      { fn: "generate_draft", ts: new Date(now - 5 * 60000).toISOString(), costEstimate: 0.3 }, // not dna_
      { fn: "agent_synthesis", ts: new Date(now - 5 * 60000).toISOString(), costEstimate: 0.3 },
      { ts: new Date(now - 5 * 60000).toISOString(), costEstimate: 0.3 },                       // no fn at all
    ]));
    expect(workerSpendThisHour()).toBeCloseTo(0.03, 10);
  });
});

// ── workerTaskSpendThisHour ───────────────────────────────────────────────────
// The other half of the $/hr cap: seam-driven task costs off the worklog. The
// cap check adds both — without this, draft/classify/enrich/followup spend was
// invisible to the ceiling and the dock's "$/hr" was decorative.
describe("workerTaskSpendThisHour", () => {
  it("sums the last hour's worklog costs, skipping dna_-seamed kinds (already in obs)", () => {
    const now = Date.now();
    const log = [
      { kind: "draft", status: "done", cost: 0.04, ts: new Date(now - 5 * 60000).toISOString() },
      { kind: "classify", status: "done", cost: 0.03, ts: new Date(now - 20 * 60000).toISOString() },
      { kind: "strategy", status: "done", cost: 0.02, ts: new Date(now - 10 * 60000).toISOString() }, // dna_strategy — counted by workerSpendThisHour, not here
      { kind: "grow", status: "done", cost: 0, ts: new Date(now - 8 * 60000).toISOString() },          // free
      { kind: "draft", status: "done", cost: 0.9, ts: new Date(now - 2 * 3600000).toISOString() },     // too old
      { kind: "enrich", status: "failed", ts: new Date(now - 3 * 60000).toISOString() },               // no cost field
    ];
    expect(workerTaskSpendThisHour(log, now)).toBeCloseTo(0.07, 10);
    expect(workerTaskSpendThisHour([], now)).toBe(0);
    expect(workerTaskSpendThisHour(null, now)).toBe(0);
  });
});

// ── proposeTasks ──────────────────────────────────────────────────────────────
describe("proposeTasks — draft", () => {
  it("proposes for prospected cards with an email and no draft, capped at 2, highest value first", () => {
    const cards = [
      card({ id: "b", prospect: { business_name: "B", category: "law firm", ads_detected: false } }),
      card({ id: "a", prospect: { business_name: "A", category: "law firm", ads_detected: true } }), // ads-live ⇒ 1.15× value
      card({ id: "c", prospect: { business_name: "C", category: "law firm", ads_detected: false } }),
    ];
    const drafts = kinds(proposeTasks(cards, G, [], opts()), "draft");
    expect(drafts).toHaveLength(2);
    expect(drafts.map(t => t.cardId)).toEqual(["a", "b"]); // value desc, stable on ties
    expect(drafts[0].dedupKey).toBe("draft_a");
    expect(drafts[0].title).toContain("A");
  });

  it("never proposes over an existing draft, a missing email, or a non-prospected status", () => {
    const cards = [
      card({ id: "drafted", draft_subject: "already written" }),
      card({ id: "no_email", contact: { email: null } }),
      card({ id: "no_contact", contact: null }),
      card({ id: "sent", status: "sent", sent_at: new Date().toISOString() }),
    ];
    expect(kinds(proposeTasks(cards, G, [], opts()), "draft")).toEqual([]);
  });
});

describe("proposeTasks — classify", () => {
  it("proposes only for replied cards with a body and no classification, and ranks it first", () => {
    const cards = [
      card({ id: "d1" }), // draft-eligible
      card({ id: "r1", status: "replied", reply_body: "sounds interesting" }),
      card({ id: "r2", status: "replied", reply_body: "yes", reply_classification: "interested" }), // done
      card({ id: "r3", status: "replied", reply_body: null }),                                       // nothing to read
    ];
    const tasks = proposeTasks(cards, G, [], opts());
    expect(kinds(tasks, "classify").map(t => t.cardId)).toEqual(["r1"]);
    expect(tasks[0].kind).toBe("classify"); // the warmest signal outranks every other queue
  });
});

describe("proposeTasks — enrich", () => {
  it("proposes at most one enrich per pass, only for prospected cards without an email", () => {
    const cards = [
      card({ id: "e1", contact: { email: null } }),
      card({ id: "e2", contact: null }),
      card({ id: "has_email" }),
    ];
    const enriches = kinds(proposeTasks(cards, G, [], opts()), "enrich");
    expect(enriches).toHaveLength(1);
    expect(enriches[0].cardId).toBe("e1");
  });
});

describe("proposeTasks — followup", () => {
  const dueCard = (id) => card({
    id, status: "sent", contact: { email: "x@y.z" },
    sent_at: new Date(Date.now() - 10 * 86400000).toISOString(), // 10 days silent ⇒ cadence due
  });

  it("proposes one due, unowned, undrafted sent card per pass", () => {
    const tasks = proposeTasks([dueCard("f1"), dueCard("f2")], G, [], opts());
    const fu = kinds(tasks, "followup");
    expect(fu).toHaveLength(1); // cap 1/pass
    expect(fu[0].cardId).toBe("f1");
  });

  it("never duplicates the sequence engine or an existing draft", () => {
    const run = (cards, over) => kinds(proposeTasks(cards, G, [], opts(over)), "followup");
    // owned by an active enrollment
    expect(run([dueCard("f1")], { enrollments: [{ outreach_id: "f1", status: "active" }] })).toEqual([]);
    // paused still owns the thread
    expect(run([dueCard("f1")], { enrollments: [{ outreach_id: "f1", status: "paused" }] })).toEqual([]);
    // completed enrollment releases it
    expect(run([dueCard("f1")], { enrollments: [{ outreach_id: "f1", status: "completed" }] })).toHaveLength(1);
    // an outbound draft already sits in the ledger
    expect(run([dueCard("f1")], { messages: [{ outreach_id: "f1", direction: "outbound", status: "draft" }] })).toEqual([]);
    // legacy card-level draft blocks too
    expect(run([{ ...dueCard("f1"), reply_draft: "already written" }], {})).toEqual([]);
  });

  it("fails safe when enrollment/ledger data is unavailable, and waits for the cadence", () => {
    // null data = unknown ownership → propose nothing rather than risk a double-touch
    expect(kinds(proposeTasks([dueCard("f1")], G, [], opts({ enrollments: null })), "followup")).toEqual([]);
    expect(kinds(proposeTasks([dueCard("f1")], G, [], opts({ messages: null })), "followup")).toEqual([]);
    // sent moments ago → not due yet
    const freshSend = card({ id: "f2", status: "sent", sent_at: new Date().toISOString() });
    expect(kinds(proposeTasks([freshSend], G, [], opts()), "followup")).toEqual([]);
  });
});

describe("proposeTasks — dedup vs today's worklog", () => {
  it("skips any {kind,dedupKey} already attempted today, whatever the status", () => {
    const cards = [card({ id: "a" }), card({ id: "b", prospect: { business_name: "B", category: "hvac contractor", ads_detected: false } })];
    const log = [{ kind: "draft", dedupKey: "draft_a", status: "failed", ts: new Date().toISOString() }];
    const drafts = kinds(proposeTasks(cards, G, log, opts()), "draft");
    expect(drafts.map(t => t.cardId)).toEqual(["b"]); // a failed TODAY → one shot per day
  });

  it("yesterday's attempt does not block today", () => {
    const log = [{ kind: "draft", dedupKey: "draft_a", status: "done", ts: new Date(Date.now() - 86400000).toISOString() }];
    expect(kinds(proposeTasks([card({ id: "a" })], G, log, opts()), "draft")).toHaveLength(1);
  });

  it("dedups by LOCAL calendar day — the gates never reset at UTC midnight mid-shift", () => {
    // 18:05 → 19:05 local on the same evening. In Chicago (the app's persona)
    // these straddle UTC midnight; keyed to the UTC date the strategy gate
    // reopened at 19:05 and the evening brief ran — and paid — twice a night.
    const log = [{ kind: "strategy", dedupKey: "evening_brief", status: "done", ts: at(18, 5).toISOString() }];
    expect(kinds(proposeTasks([card({ id: "a" })], G, log, opts({ now: at(19, 5) })), "strategy")).toEqual([]);
    // …and an entry lacking ts entirely never poisons the dedup set.
    const noTs = [{ kind: "strategy", dedupKey: "evening_brief", status: "done" }];
    expect(kinds(proposeTasks([card({ id: "a" })], G, noTs, opts({ now: at(19, 5) })), "strategy")).toHaveLength(1);
  });
});

describe("proposeTasks — gates", () => {
  it("respects taskTypes off per kind", () => {
    const cards = [card({ id: "a" }), card({ id: "r", status: "replied", reply_body: "hi" })];
    const learnings = [{ id: "k1", type: "learning", text: "Learning: med spa converts" }];
    const tasks = proposeTasks(cards, G, [], opts({
      taskTypes: { ...ALL_ON, draft: false, strategy: false, grow: false }, learnings,
    }));
    expect(kinds(tasks, "draft")).toEqual([]);
    expect(kinds(tasks, "strategy")).toEqual([]);
    expect(kinds(tasks, "grow")).toEqual([]);
    expect(kinds(tasks, "classify")).toHaveLength(1); // still on
  });

  it("the genome is functional — a silenced or deleted skill node stops its task kind", () => {
    const cards = [card({ id: "a" })];
    const silenced = updateNode(G, "n_sk_draft", { enabled: false });
    expect(kinds(proposeTasks(cards, silenced, [], opts()), "draft")).toEqual([]);
    const excised = removeNode(G, "n_sk_draft");
    expect(kinds(proposeTasks(cards, excised, [], opts()), "draft")).toEqual([]);
    expect(kinds(proposeTasks(cards, G, [], opts()), "draft")).toHaveLength(1); // intact mind still drafts
  });
});

describe("proposeTasks — daily rituals", () => {
  it("strategy fires at most once per day and needs a pipeline to brief on", () => {
    const cards = [card({ id: "a" })];
    expect(kinds(proposeTasks(cards, G, [], opts()), "strategy")).toHaveLength(1);
    const log = [{ kind: "strategy", dedupKey: "evening_brief", status: "skipped", ts: new Date().toISOString() }];
    expect(kinds(proposeTasks(cards, G, log, opts()), "strategy")).toEqual([]); // any status counts
    expect(kinds(proposeTasks([], G, [], opts()), "strategy")).toEqual([]);     // empty pipeline, nothing to brief
  });

  it("grow fires once per day and only when a learning is not yet reflected", () => {
    const learnings = [{ id: "k1", dedupKey: "vertical_rates", type: "learning", text: "Learning: med spa converts best" }];
    expect(kinds(proposeTasks([], G, [], opts({ learnings })), "grow")).toHaveLength(1);
    // already turned into a suggestion (accepted OR dismissed) → no re-nag
    const pastSuggestions = [{ dedupKey: "kb_vertical_rates", resolved: true, accepted: false }];
    expect(kinds(proposeTasks([], G, [], opts({ learnings, pastSuggestions })), "grow")).toEqual([]);
    // nothing learned → no proposal, the daily slot isn't wasted
    expect(kinds(proposeTasks([], G, [], opts({ learnings: [] })), "grow")).toEqual([]);
    // already scanned today → gated
    const log = [{ kind: "grow", dedupKey: "grow_scan", status: "done", ts: new Date().toISOString() }];
    expect(kinds(proposeTasks([], G, log, opts({ learnings })), "grow")).toEqual([]);
  });
});

describe("proposeTasks — purity", () => {
  it("mutates nothing and agrees with itself for the same now", () => {
    const cards = [card({ id: "a" }), card({ id: "r", status: "replied", reply_body: "hi" })];
    const log = [{ kind: "draft", dedupKey: "draft_x", status: "done", ts: new Date().toISOString() }];
    const now = new Date();
    const snapCards = JSON.stringify(cards);
    const snapG = JSON.stringify(G);
    const snapLog = JSON.stringify(log);
    const a = proposeTasks(cards, G, log, opts({ now }));
    const b = proposeTasks(cards, G, log, opts({ now }));
    expect(a).toEqual(b);
    expect(JSON.stringify(cards)).toBe(snapCards);
    expect(JSON.stringify(G)).toBe(snapG);
    expect(JSON.stringify(log)).toBe(snapLog);
  });
});

// ── the approval-spine invariant, enforced on the source itself ───────────────
// AD-2: there must be NO code path from the worker to sending. This pins it at
// the text level so a future edit that so much as imports sendEmail or writes a
// "sent" status fails the suite before it ever reaches a human.
describe("approval spine (AD-2)", () => {
  it("the worker's source never touches sendEmail, markSent, or a 'sent' status write", () => {
    const src = readFileSync(new URL("../dnaWorker.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/sendEmail/);
    expect(src).not.toMatch(/markSent/);
    expect(src).not.toMatch(/status:\s*["'`]sent["'`]/);
    expect(src).toMatch(/status:\s*"draft"/); // and it does write drafts — the only exit
  });
});
