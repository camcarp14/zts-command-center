import { useEffect, useRef } from "react";
import { callClaude } from "./claudeApi.js";
import { classifyReplyAI } from "./classify.js";
import { compileGenome, dnaBus, loadGenome, propagate, seedsForTask } from "./dna.js";
import { cadenceState, cleanBody, cleanSubject, generateReplyDraft } from "./email.js";
import { buildFactsBlock, kb } from "./engine.js";
import { estimateValue } from "./leads.js";
import { enrichProspect, generateDraft, generateFollowUpDraft } from "./prospecting.js";
import { seqDb } from "./sequenceDb.js";
import { obs, sm } from "./store.js";
import { db } from "./supabase.js";

// ════════════════════════════════════════════════════════════════════════════
// DNA WORKER — the hands of the mind. It reads the genome, proposes real
// pipeline tasks (draft, enrich, classify, follow-up, strategy, grow), and
// executes ONE per pass through the exact seams the human flows use — so every
// result lands where a human click would have put it. THE WORKER NEVER SENDS:
// the email-send seam is not even imported, and no status is ever written but
// "draft" (dnaWorker.test.js pins both facts against this file's source text).
// The approval queue is the only exit (AD-2, and the genome's locked
// n_pr_approval node says the same thing in prompt form).
// Pattern lineage: engine.js — sm control object, guard locks in order, obs
// cost accounting, headless component polling on a free 2s heartbeat.
// ════════════════════════════════════════════════════════════════════════════

export const WORKER_DEFAULTS = {
  running: false,                                          // master switch — $0 until you flip it
  eveningShift: { enabled: false, start: "18:00", end: "23:00" }, // works while you eat dinner
  cadenceSec: 30,                                          // seconds between work passes
  maxTasksPerHour: 6,                                      // serial + calm, never a firehose
  hourlyCostCap: 0.25,                                     // $ ceiling on the worker's hourly spend — dna_ calls AND seam-driven task costs
  taskTypes: { draft: true, enrich: false, classify: true, followup: false, strategy: true, grow: true },
};

// Kinds that can reach a paid model call (enrich counts — its brief fallback is
// a Claude call). When the cost cap trips these go dark; `grow` is pure JS over
// the kb and stays available, so the mind keeps growing even when it's broke.
const PAID_KINDS = ["draft", "enrich", "classify", "followup", "strategy"];

// Which skill node in the genome owns each task kind. This is what makes the
// graph FUNCTIONAL rather than decorative: silence (or delete) "Draft cold
// outreach" on the canvas and the worker stops proposing drafts — no separate
// setting, the mind IS the config. A genome without these nodes (a future
// google_ads genome) simply has a worker with different hands.
const SKILL_FOR_KIND = {
  draft: "n_sk_draft", enrich: "n_sk_enrich", classify: "n_sk_classify",
  followup: "n_sk_followup", strategy: "n_sk_strategy", grow: "n_sk_grow",
};

// Per-kind fn names the underlying seams log to obs — used to attribute a
// task's true cost to its worklog entry without touching the seams' own
// accounting. Time-window filtered (not length-diffed) so the obs ring
// buffer's 300-entry cap can never make a task's spend invisible.
const SEAM_FNS = {
  draft: ["generate_draft"],
  enrich: ["enrich_brief"],
  classify: ["reply_classify", "reply_draft"],
  followup: ["followup_draft"],
  strategy: ["dna_strategy"],
  grow: [], // free — pure JS over the kb
};


// ─── control + stores (sm-backed, same layer as the engine's) ───────────────
export const wk = {
  // Deep-merge the nested objects so a partial patch written by an older build
  // (or a user toggling one task type) never wipes its siblings back to nothing.
  get: () => {
    const c = sm.get("dna_worker_ctrl") || {};
    return {
      ...WORKER_DEFAULTS, ...c,
      eveningShift: { ...WORKER_DEFAULTS.eveningShift, ...(c.eveningShift || {}) },
      taskTypes: { ...WORKER_DEFAULTS.taskTypes, ...(c.taskTypes || {}) },
    };
  },
  set: (patch) => sm.set("dna_worker_ctrl", { ...wk.get(), ...patch }),
  setTask: (key, on) => { const c = wk.get(); wk.set({ taskTypes: { ...c.taskTypes, [key]: on } }); },
};

const stamp = () => ({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ts: new Date().toISOString() });

export const worklog = {
  all: () => sm.get("dna_worklog") || [],
  // entry: {kind, title, status:"done"|"failed"|"skipped", detail, cost, durationMs,
  //         trace:{seeds,levels,...}, dedupKey, cardId?} — id/ts stamped here.
  // dedupKey rides on every entry because proposeTasks' today-dedup reads it back.
  add: (entry) => {
    const stamped = { ...stamp(), ...entry };
    sm.set("dna_worklog", [stamped, ...worklog.all()].slice(0, 300));
    return stamped;
  },
  clear: () => sm.set("dna_worklog", []),
};

export const suggestions = {
  all: () => sm.get("dna_suggestions") || [],
  // A suggestion is a node the mind wants to grow: {label, region, text, dedupKey}.
  // Dedup by dedupKey — dismissed counts as handled, the mind doesn't nag twice
  // about the same learning. Returns null on a dupe so callers can tell.
  add: (s) => {
    const all = suggestions.all();
    if (s.dedupKey && all.some(x => x.dedupKey === s.dedupKey)) return null;
    const stamped = { ...stamp(), resolved: false, accepted: null, ...s };
    sm.set("dna_suggestions", [stamped, ...all].slice(0, 60));
    return stamped;
  },
  resolve: (id, accepted) => sm.set("dna_suggestions", suggestions.all().map(x =>
    x.id === id ? { ...x, resolved: true, accepted: !!accepted, resolved_at: new Date().toISOString() } : x
  )),
};


// ─── inShift — pure clock math, overnight-aware ──────────────────────────────
// "HH:MM"→"HH:MM" in the browser's local time. Start is inclusive, end is
// exclusive (an 18:00→23:00 shift starts working AT 18:00 and stops AT 23:00).
// start > end means the window wraps midnight (22:00→02:00 covers 23:30 and
// 01:59 but not 12:00). start === end is a zero-length window — never in shift
// (a "24h shift" is what `running` is for). Malformed times fail closed.
export function inShift(shift, now = new Date()) {
  const parse = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return (+m[1]) * 60 + (+m[2]);
  };
  const start = parse(shift?.start), end = parse(shift?.end);
  if (start === null || end === null || start === end) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return start < end ? t >= start && t < end : t >= start || t < end;
}


// ─── proposeTasks — PURE. What would the mind do right now? ─────────────────
// Reads only its arguments; every impure source (kb, suggestions store,
// enrollments, ledger drafts, the clock) arrives via `opts` so the tick feeds
// it live data and tests feed it fixtures. Returns [{kind, title, cardId?,
// dedupKey}] in execution-priority order — the tick takes tasks[0].
//
// Priority mirrors what the seed genome literally says: n_sg_reply_class calls
// an interested reply "the warmest signal in the pipeline — it outranks every
// other queue", so classify leads; drafts follow ordered by money (n_sg_value:
// "work the pipeline by money, not count"); then enrich, follow-up, and the
// once-a-day strategy/grow rituals.
const bizName = (c) => c?.prospect?.business_name || "Unknown business";

export function proposeTasks(cards, genome, log, opts = {}) {
  const {
    taskTypes = WORKER_DEFAULTS.taskTypes,
    now = new Date(),
    enrollments = null,   // null = data unavailable → propose NO follow-ups (fail safe)
    messages = null,      // outbound draft ledger rows; same fail-safe
    learnings = [],       // kb entries of type "learning" (tick passes kb.all() filtered)
    pastSuggestions = [], // suggestions.all() — what the mind already proposed
  } = opts;
  const all = cards || [];

  // Today-dedup: a {kind,dedupKey} pair attempted today — done, failed, or
  // skipped — is not re-proposed. A failing task gets one shot per day, not an
  // infinite retry loop burning the task budget. "Today" is the LOCAL calendar
  // day — the same clock inShift and the dock's "N tasks today" read — so the
  // gates roll at the user's midnight. Keyed to the UTC date they'd reset at
  // 6-7pm Chicago time, mid-way through the default evening shift, and every
  // once-per-day ritual would run (and pay) twice in one evening.
  const day = (d) => new Date(d).toDateString();
  const today = day(now);
  const doneToday = new Set((log || [])
    .filter(e => e.ts && day(e.ts) === today)
    .map(e => `${e.kind}:${e.dedupKey}`));
  const fresh = (kind, key) => !doneToday.has(`${kind}:${key}`);

  // A kind runs only if its control toggle is on AND its skill node is awake
  // in the genome — the canvas's enable switch is a real off switch.
  const skillAwake = (kind) => {
    const n = (genome?.nodes || []).find(x => x.id === SKILL_FOR_KIND[kind]);
    return !!n && n.enabled !== false;
  };
  const on = (kind) => taskTypes[kind] === true && skillAwake(kind);

  const tasks = [];

  // classify — warmest signal, uncapped in the list (the tick runs one/pass anyway)
  if (on("classify")) {
    all.filter(c => c.status === "replied" && c.reply_body && !c.reply_classification)
      .filter(c => fresh("classify", `classify_${c.id}`))
      .forEach(c => tasks.push({ kind: "classify", title: `Classify reply — ${bizName(c)}`, cardId: c.id, dedupKey: `classify_${c.id}` }));
  }

  // draft — max 2/pass, highest estimated value first, never over an existing draft
  if (on("draft")) {
    all.filter(c => c.status === "prospected" && !c.draft_subject && c.contact?.email)
      .filter(c => fresh("draft", `draft_${c.id}`))
      .sort((a, b) => estimateValue(b).monthly - estimateValue(a).monthly)
      .slice(0, 2)
      .forEach(c => tasks.push({ kind: "draft", title: `Draft ${bizName(c)}`, cardId: c.id, dedupKey: `draft_${c.id}` }));
  }

  // enrich — max 1/pass (two external APIs per run is plenty of politeness)
  if (on("enrich")) {
    const c = all.find(x => x.status === "prospected" && !x.contact?.email && fresh("enrich", `enrich_${x.id}`));
    if (c) tasks.push({ kind: "enrich", title: `Enrich ${bizName(c)}`, cardId: c.id, dedupKey: `enrich_${c.id}` });
  }

  // followup — cap 1/pass, and NEVER a duplicate of the sequence engine: a card
  // owned by any live enrollment (active or paused — paused still owns the
  // thread) is off limits, as is one that already has an outbound draft in the
  // ledger or a legacy reply_draft on the card. Requires the cadence to say a
  // touch is actually due — a card sent this morning is not "silent" yet.
  // When enrollment/ledger data didn't load, we propose nothing (fail safe).
  if (on("followup") && Array.isArray(enrollments) && Array.isArray(messages)) {
    const owned = new Set(enrollments.filter(e => e.status === "active" || e.status === "paused").map(e => e.outreach_id));
    const drafted = new Set(messages.filter(m => m.direction === "outbound" && m.status === "draft").map(m => m.outreach_id));
    const c = all.find(x => {
      if (x.status !== "sent" || owned.has(x.id) || drafted.has(x.id) || x.reply_draft) return false;
      if (!fresh("followup", `followup_${x.id}`)) return false;
      const st = cadenceState(x); // pure given the card; reads the wall clock vs sent_at
      return !!st && !st.done && st.due;
    });
    if (c) tasks.push({ kind: "followup", title: `Follow up — ${bizName(c)}`, cardId: c.id, dedupKey: `followup_${c.id}` });
  }

  // strategy — the evening brief, at most once per day (constant dedupKey +
  // today-dedup = the once-a-day gate). Needs a pipeline to brief on.
  if (on("strategy") && all.length > 0 && fresh("strategy", "evening_brief")) {
    tasks.push({ kind: "strategy", title: "Compile evening brief", dedupKey: "evening_brief" });
  }

  // grow — once per day, and only when the kb holds a learning the mind hasn't
  // already turned into a suggestion (matched by the dedupKey stored on the
  // suggestion). No material → no proposal, so the daily slot isn't wasted.
  if (on("grow") && fresh("grow", "grow_scan")) {
    const reflected = new Set((pastSuggestions || []).map(s => s.dedupKey));
    if ((learnings || []).some(e => !reflected.has(`kb_${e.dedupKey || e.id}`))) {
      tasks.push({ kind: "grow", title: "Grow the mind", dedupKey: "grow_scan" });
    }
  }

  return tasks;
}


// ─── cost accounting ─────────────────────────────────────────────────────────
// The worker's own directly-tracked spend: obs entries whose fn carries the
// dna_ prefix (dna_strategy here; dna_pulse from the DNA tab) in the last hour.
// Seam-driven calls (generate_draft etc.) keep their own fn names so Ops
// attributes them where it always has — but they are still the worker's
// spending, so the tick's cap check adds workerTaskSpendThisHour below.
export function workerSpendThisHour() {
  const hourAgo = Date.now() - 3600000;
  return obs.getAll()
    .filter(l => typeof l.fn === "string" && l.fn.startsWith("dna_") && new Date(l.ts).getTime() > hourAgo)
    .reduce((s, l) => s + (l.costEstimate || 0), 0);
}

// The seam-driven half of the worker's bill: per-task costs attributed on the
// last hour's worklog entries (costSince stamps each entry with what its seams
// actually logged). Without this the $/hr cap only ever saw dna_strategy and
// the dock's ceiling was decorative — draft/classify/enrich/followup spend ran
// invisible to it. Kinds whose seams ARE dna_-prefixed (strategy) are skipped
// here because workerSpendThisHour already counts them — never double-booked.
export function workerTaskSpendThisHour(log, now = Date.now()) {
  const hourAgo = now - 3600000;
  return (log || [])
    .filter(e => new Date(e.ts).getTime() > hourAgo && !(SEAM_FNS[e.kind] || []).some(fn => fn.startsWith("dna_")))
    .reduce((s, e) => s + (e.cost || 0), 0);
}

// Sum what THIS task cost: obs entries logged since t0 under the kind's known
// seam fns. Attribution for the work log, not double-booked into Ops totals.
function costSince(t0, kind) {
  const fns = SEAM_FNS[kind] || [];
  if (fns.length === 0) return 0;
  return obs.getAll()
    .filter(l => fns.includes(l.fn) && new Date(l.ts).getTime() >= t0)
    .reduce((s, l) => s + (l.costEstimate || 0), 0);
}

// Squeeze a kb learning into a ≤28-char canvas label, cut on a word boundary.
function learningLabel(text) {
  const t = String(text || "").replace(/^learning:\s*/i, "").trim();
  if (!t) return "New learning";
  if (t.length <= 28) return t;
  const cut = t.slice(0, 28);
  const sp = cut.lastIndexOf(" ");
  return (sp > 12 ? cut.slice(0, sp) : cut).replace(/[,;:.\s]+$/, "");
}


// ─── executeTask — one task, end to end ──────────────────────────────────────
// Emits the activation trace BEFORE doing the work (the canvas lights up as the
// mind acts, not after), runs the same seam the human flow uses, persists to
// the same places, and returns the worklog entry — the tick adds it. Never
// throws: every failure comes back as a status:"failed" entry with the error
// in `detail`. Every output is a DRAFT — nothing in here can send.
export async function executeTask(task, ctx) {
  const { cards = [], toneMemory = [], genome } = ctx || {};
  const t0 = Date.now();

  const seeds = seedsForTask(genome, task.kind);
  const full = propagate(genome, seeds);
  dnaBus.emit({ type: "activation", seeds, trace: full, label: task.title });

  // Persisted trace keeps only lit nodes — a 300-entry log of mostly-zero level
  // maps would chew localStorage for nothing. order/edgesFired ride along so
  // the work log's hover-replay animates identically to the live firing.
  const levels = {};
  Object.entries(full.levels).forEach(([id, v]) => { if (v > 0) levels[id] = Math.round(v * 1000) / 1000; });
  const trace = { seeds, levels, order: full.order, edgesFired: full.edgesFired };

  const base = { kind: task.kind, title: task.title, cardId: task.cardId, dedupKey: task.dedupKey };
  const finish = (status, detail) => ({ ...base, status, detail, cost: costSince(t0, task.kind), durationMs: Date.now() - t0, trace });

  const card = task.cardId ? cards.find(c => c.id === task.cardId) : null;
  if (task.cardId && !card) return finish("skipped", "Card left the pipeline before the worker reached it");

  try {
    switch (task.kind) {
      case "draft": {
        // Same seam + same persistence as runProspecting's auto-draft:
        // outreach row patched to status "draft" → the human approval queue.
        const draft = await generateDraft(card.prospect || {}, card.contact || {}, toneMemory);
        if (!draft?.subject && !draft?.body) return finish("failed", "Model returned an empty draft");
        await db.updateOutreach(card.id, { draft_subject: draft.subject || "", draft_body: draft.body || "", status: "draft" });
        return finish("done", `"${draft.subject || "(no subject)"}" → approval queue`);
      }

      case "enrich": {
        // enrichProspect does its own DB writes (contact + prospect rows),
        // identical to the board's enrich button. A graceful decline (no
        // domain) is a skip, not a failure — nothing went wrong, there was
        // simply nothing to work with.
        const r = await enrichProspect(card, () => {});
        if (!r?.success) return finish("skipped", `Enrichment declined: ${r?.reason || "nothing to work with"}`);
        const bits = [
          r.email ? `email ${r.email} (${r.confidence ?? "?"}%)` : "no email found",
          r.adsDetected ? "ads LIVE" : "no ads detected",
          r.hasBrief ? "brief built" : null,
        ].filter(Boolean).join(" · ");
        return finish("done", bits);
      }

      case "classify": {
        // Mirrors the reply-poller in App.jsx line for line: classify → card
        // columns → ledger classification → suggested reply as a DRAFT (legacy
        // reply_draft dual-write + messages row into the approval queue).
        const cls = await classifyReplyAI({
          replyBody: card.reply_body, replyFrom: card.reply_from,
          originalSubject: card.draft_subject, originalBody: card.draft_body,
          prospect: card.prospect || {}, toneMemory,
        });
        await db.updateOutreach(card.id, {
          reply_classification: cls.classification,
          reply_classification_confidence: cls.confidence,
          reply_classification_source: cls.source,
        });
        try { // stamp the inbound ledger row too, like the human flow does
          const msgs = await seqDb.getMessagesFor([card.id]);
          const inbound = (msgs || []).filter(m => m.direction === "inbound" && !m.classification).pop();
          if (inbound) {
            await seqDb.updateMessage(inbound.id, {
              classification: cls.classification, classification_confidence: cls.confidence,
              classification_source: cls.source, classified_at: new Date().toISOString(),
            });
          }
        } catch {}
        const draft = cls.suggested || await generateReplyDraft(
          { subject: card.draft_subject, body: card.draft_body },
          { body: card.reply_body, from: card.reply_from, subject: card.reply_subject },
          card.prospect || {}, toneMemory,
        );
        if (draft?.body) {
          await db.saveReplyDraft(card.id, draft.subject, draft.body);
          try {
            await seqDb.insertMessage({
              outreach_id: card.id, direction: "outbound", kind: "reply",
              subject: draft.subject, body: draft.body, status: "draft",
              gmail_thread_id: card.gmail_thread_id || null,
              meta: { classification: cls.classification, source: cls.source, drafted_by: "dna_worker" },
            });
          } catch {}
        }
        return finish("done", `${cls.classification} (${Math.round((cls.confidence || 0) * 100)}%)${draft?.body ? " — reply drafted → approval queue" : ""}`);
      }

      case "followup": {
        // Same seam as the thread modal's follow-up button; persisted both ways
        // the app persists drafts — legacy reply_draft columns for the Kanban,
        // a status:"draft" ledger row for the approval queue.
        const draft = await generateFollowUpDraft(
          card.prospect || {}, card.contact || {},
          cleanSubject(card.draft_subject), cleanBody(card.draft_body), toneMemory,
        );
        const subject = draft?.subject || `Re: ${cleanSubject(card.draft_subject)}`;
        const body = draft?.body ? cleanBody(draft.body) : "";
        if (!body) return finish("failed", "Model returned an empty follow-up");
        await db.saveReplyDraft(card.id, subject, body);
        try {
          await seqDb.insertMessage({
            outreach_id: card.id, direction: "outbound", kind: "followup",
            subject, body, status: "draft",
            gmail_thread_id: card.gmail_thread_id || null,
            meta: { drafted_by: "dna_worker" },
          });
        } catch {}
        return finish("done", `"${subject}" → approval queue`);
      }

      case "strategy": {
        // THE payoff of the whole tab: the compiled genome IS the system
        // prompt. Tune a weight on the canvas and tonight's brief thinks
        // differently. Haiku, dna_-prefixed fn, facts block so it cites real
        // numbers instead of inventing them (n_pr_no_invent would like a word).
        const { systemPrompt, hash } = compileGenome(genome);
        const user = `Evening shift brief. The pipeline's actual state right now:\n\n${buildFactsBlock(cards)}\n\nIn 2-4 sentences, name the single highest-leverage move for tomorrow morning and why — specific, actionable, citing the numbers above. No preamble, no menu of options.`;
        const r = await callClaude({
          model: "claude-haiku-4-5-20251001", max_tokens: 300,
          system: systemPrompt, messages: [{ role: "user", content: user }],
          fn: "dna_strategy", promptChars: systemPrompt.length + user.length,
        });
        if (!r.ok || !r.text) return finish("failed", r.error || "No response from model");
        kb.add([{ agent: "dna_worker", type: "insight", signal: "info", dedupKey: "evening_brief", text: r.text, mindHash: hash }]);
        return finish("done", r.text);
      }

      case "grow": {
        // Free introspection: kb learnings the mind hasn't reflected yet become
        // knowledge-node suggestions for the human to accept or dismiss on the
        // canvas. Keyed kb_<dedupKey||id> so the same learning never nags twice.
        // Capped at 3 per run — growth should feel considered, not spammy.
        const reflected = new Set(suggestions.all().map(s => s.dedupKey));
        const material = kb.all()
          .filter(e => e.type === "learning" && !reflected.has(`kb_${e.dedupKey || e.id}`))
          .slice(0, 3);
        if (material.length === 0) return finish("skipped", "No new learnings to reflect");
        const added = [];
        material.forEach(e => {
          const s = suggestions.add({
            label: learningLabel(e.text), region: "knowledge", text: e.text,
            dedupKey: `kb_${e.dedupKey || e.id}`, from: e.agent || "engine",
          });
          if (s) added.push(s.label);
        });
        if (added.length === 0) return finish("skipped", "No new learnings to reflect");
        return finish("done", `Proposed ${added.length} node${added.length !== 1 ? "s" : ""}: ${added.join(", ")}`);
      }

      default:
        return finish("failed", `Unknown task kind "${task.kind}"`);
    }
  } catch (err) {
    return finish("failed", err?.message || "Unknown error");
  }
}


// ─── DnaWorker — the headless component, mounted once at App root ───────────
// Same loop shape as AgentEngine: a free 2s poll for responsive pause, real
// work only every cadenceSec. It runs when the master switch is on OR the
// evening shift window is open — the shift deliberately has NO idle gate;
// working the evening while nobody's at the keyboard is its entire purpose
// (the tab does have to stay open — localStorage-and-JS has no server half).
// Guard locks, in order: task-type gate → hourly task cap → cost cap (paid
// kinds off, free ones through) → propose → execute ONE → log.
export function DnaWorker({ cards, toneMemory }) {
  const cardsRef = useRef(cards);
  const toneRef = useRef(toneMemory);
  useEffect(() => { cardsRef.current = cards; }, [cards]);
  useEffect(() => { toneRef.current = toneMemory; }, [toneMemory]);

  useEffect(() => {
    let lastWork = 0;
    let busy = false; // re-entrancy latch — a slow task must not overlap the next pass

    const poll = setInterval(async () => {
      if (busy) return;
      const ctrl = wk.get();
      const shiftOn = ctrl.eveningShift.enabled && inShift(ctrl.eveningShift);
      if (!ctrl.running && !shiftOn) return;             // fully off — truly $0
      const now = Date.now();
      if (now - lastWork < ctrl.cadenceSec * 1000) return; // not time for a pass yet
      lastWork = now;
      busy = true;

      try {
        // Lock: hourly task cap — every attempt counts (done, failed, skipped),
        // so a run of failures can't turn into a run of retries.
        const hourAgo = now - 3600000;
        const log = worklog.all();
        const executed = log.filter(e => new Date(e.ts).getTime() > hourAgo).length;
        if (executed >= ctrl.maxTasksPerHour) return;

        // Lock: cost cap — paid kinds go dark, free ones still run. Counts the
        // dna_-tracked calls PLUS the seam-driven spend attributed on worklog
        // entries, so the dock's $/hr number is a real ceiling on the worker's
        // whole bill. The dock reads dna_cost_capped to say why the mind went
        // quiet.
        const capped = workerSpendThisHour() + workerTaskSpendThisHour(log, now) >= ctrl.hourlyCostCap;
        sm.set("dna_cost_capped", capped);
        const types = { ...ctrl.taskTypes };
        if (capped) PAID_KINDS.forEach(k => { types[k] = false; });

        // Re-fetch the board once per work pass: App only refreshes `cards` on
        // user action, so during an unattended evening shift the prop snapshot
        // freezes at arming time — every card the worker already drafted or
        // classified would still look untouched to later passes, and the daily
        // dedup would be the only thing standing between it and paid rework.
        // A fetch failure falls back to the freshest snapshot we have.
        let cards = cardsRef.current || [];
        try {
          const fresh = await db.getOutreachBoard();
          if (Array.isArray(fresh)) { cards = fresh; cardsRef.current = fresh; }
        } catch {}

        // Propose against the live genome. Enrollment/ledger reads only happen
        // when follow-ups are even in play — no idle DB chatter every 30s.
        const genome = loadGenome();
        let enrollments = null, messages = null;
        if (types.followup) {
          try { enrollments = await seqDb.getEnrollments(["active", "paused"]); } catch {}
          try { messages = await seqDb.getQueue(); } catch {}
        }
        const tasks = proposeTasks(cards, genome, log, {
          taskTypes: types, now: new Date(now), enrollments, messages,
          learnings: kb.all().filter(e => e.type === "learning"),
          pastSuggestions: suggestions.all(),
        });
        if (tasks.length === 0) return;

        // Execute exactly ONE task — serial, calm, watchable on the canvas.
        const task = tasks[0];
        sm.set("dna_current_task", task.title); // the dock's "● Working — …" line
        let entry;
        try {
          entry = await executeTask(task, { cards, toneMemory: toneRef.current || [], genome });
        } catch (err) {
          // executeTask fails safe internally; this catches a synchronous
          // surprise so one broken pass never kills the interval.
          entry = { ...task, status: "failed", detail: err?.message || "Unknown error", cost: 0, durationMs: 0, trace: { seeds: [], levels: {} } };
        }
        worklog.add(entry);
      } catch {} finally {
        sm.del("dna_current_task");
        sm.set("dna_last_tick", now);
        busy = false;
      }
    }, 2000);

    return () => clearInterval(poll);
  }, []);

  return null; // headless — the DNA tab is a window onto what this does
}
