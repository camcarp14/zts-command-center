import { useEffect, useRef } from "react";
import { callClaude } from "./claudeApi.js";
import { cadenceState, classifyReply } from "./email.js";
import { estimateValue, pipelineValue } from "./leads.js";
import { obs, sm } from "./store.js";

// ════════════════════════════════════════════════════════════════════════════
// AGENT ENGINE — a "living" roster that runs on a free heartbeat and only rarely
// spends tokens. The craft: ~all activity is pure-JS heuristics (zero cost); a
// single batched Claude call distills accumulated observations into an insight,
// and only when several locks all open at once.
// ════════════════════════════════════════════════════════════════════════════

export const ENGINE_DEFAULTS = {
  running: false,        // master play/pause — starts OFF so it's $0 until you opt in
  observeOnly: true,     // heuristics only, never call Claude — truly free
  cadenceSec: 20,        // how often the free heartbeat does a work pass
  synthEveryMin: 30,     // minimum minutes between paid synthesis calls
  hourlyCostCap: 0.25,   // hard $ ceiling per hour; cross it → auto observe-only
  pauseWhenIdle: true,   // stop ideating if you've been away
  idleMin: 10,           // minutes of no interaction = idle
  allowSonnet: false,    // synthesis uses Haiku unless you allow Sonnet
  verifyInsights: false, // loop upgrade A: a checker grades each insight (off by default)
  goalMode: false,       // loop upgrade B: drive the loop toward a goal (off by default)
  agents: { pipeline: true, value: true, cadence: true, reply: true, pattern: true, cost: true },
};


export const eng = {
  get: () => ({ ...ENGINE_DEFAULTS, ...(sm.get("engine_ctrl") || {}), agents: { ...ENGINE_DEFAULTS.agents, ...((sm.get("engine_ctrl") || {}).agents || {}) } }),
  set: (patch) => sm.set("engine_ctrl", { ...eng.get(), ...patch }),
  setAgent: (key, on) => { const c = eng.get(); eng.set({ agents: { ...c.agents, [key]: on } }); },
};


export const kb = {
  all: () => sm.get("agent_kb") || [],
  add: (entries) => {
    if (!entries || entries.length === 0) return 0;
    const existing = sm.get("agent_kb") || [];
    const stamped = entries.map(e => ({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ts: new Date().toISOString(), ...e }));
    sm.set("agent_kb", [...stamped, ...existing].slice(0, 400));
    return stamped.length;
  },
  clear: () => sm.set("agent_kb", []),
  // Dedup: has this agent logged this subject already today?
  seenToday: (agent, dedupKey) => {
    const today = new Date().toISOString().slice(0, 10);
    return (sm.get("agent_kb") || []).some(e => e.agent === agent && e.dedupKey === dedupKey && (e.ts || "").slice(0, 10) === today);
  },
};


// Track last user interaction so the engine can auto-pause when you're away.
export function markActivity() { sm.set("engine_last_activity", Date.now()); }

export function isIdle(idleMin) {
  const last = sm.get("engine_last_activity") || Date.now();
  return (Date.now() - last) > idleMin * 60000;
}


// ── Heuristic agents: pure functions, ZERO token cost. Each scans current state
//    and emits observations. Dedup keeps them from repeating the same finding. ──
export const HEURISTIC_AGENTS = {
  pipeline: { name: "Pipeline Watcher", scan: (ctx) => {
    const out = [];
    const stale = ctx.cards.filter(c => c.status === "prospected" && c.created_at && (Date.now() - new Date(c.created_at).getTime()) > 14 * 86400000);
    if (stale.length >= 3 && !kb.seenToday("pipeline", "stale_batch")) out.push({ agent: "pipeline", type: "observation", signal: "warning", dedupKey: "stale_batch", text: `${stale.length} prospects have sat untouched 14+ days — they're going cold. Batch-draft or archive.` });
    const draftsReady = ctx.cards.filter(c => ["draft", "draft_ready"].includes(c.status)).length;
    if (draftsReady >= 4 && !kb.seenToday("pipeline", "drafts_piling")) out.push({ agent: "pipeline", type: "observation", signal: "info", dedupKey: "drafts_piling", text: `${draftsReady} drafts are written but unsent — clearing them is the fastest pipeline move available.` });
    return out;
  }},
  value: { name: "Value Scout", scan: (ctx) => {
    const out = [];
    const highValueIdle = ctx.cards.filter(c => c.status === "prospected" && estimateValue(c).monthly >= 1500);
    if (highValueIdle.length > 0 && !kb.seenToday("value", "high_value_idle")) {
      const top = highValueIdle.sort((a, b) => estimateValue(b).monthly - estimateValue(a).monthly)[0];
      const total = highValueIdle.reduce((s, c) => s + estimateValue(c).monthly, 0);
      out.push({ agent: "value", type: "observation", signal: "warning", dedupKey: "high_value_idle", text: `${highValueIdle.length} high-value prospects un-worked (~$${(total/1000).toFixed(1)}k/mo potential). Top: ${top.prospect?.business_name}. Prioritize these over volume.` });
    }
    return out;
  }},
  cadence: { name: "Cadence Monitor", scan: (ctx) => {
    const out = [];
    const dueFollowup = ctx.cards.filter(c => { const st = cadenceState(c); return st && !st.done && st.due; });
    if (dueFollowup.length > 0 && !kb.seenToday("cadence", "followups_due")) out.push({ agent: "cadence", type: "observation", signal: "warning", dedupKey: "followups_due", text: `${dueFollowup.length} sent thread${dueFollowup.length !== 1 ? "s" : ""} ${dueFollowup.length !== 1 ? "are" : "is"} due for a follow-up touch now. Silence after one email is the #1 reason deals stall.` });
    return out;
  }},
  reply: { name: "Reply Sentinel", scan: (ctx) => {
    const out = [];
    const replies = ctx.cards.filter(c => c.status === "replied" && c.reply_body);
    const interested = replies.filter(c => classifyReply(c.reply_body).tier === "hot");
    if (interested.length > 0 && !kb.seenToday("reply", "interested_replies")) out.push({ agent: "reply", type: "observation", signal: "critical", dedupKey: "interested_replies", text: `${interested.length} repl${interested.length !== 1 ? "ies" : "y"} read as INTERESTED and ${interested.length !== 1 ? "are" : "is"} waiting. Warmest signal in the pipeline — respond before anything else.` });
    return out;
  }},
  pattern: { name: "Pattern Learner", scan: (ctx) => {
    // Builds knowledge over time: which verticals/angles actually get replies. FREE stats.
    const out = [];
    const sent = ctx.cards.filter(c => ["sent", "replied", "meeting"].includes(c.status));
    if (sent.length < 5) return out; // need a sample
    const byVert = {};
    sent.forEach(c => { const v = estimateValue(c).label; if (!byVert[v]) byVert[v] = { sent: 0, replied: 0 }; byVert[v].sent++; if (["replied","meeting"].includes(c.status)) byVert[v].replied++; });
    const ranked = Object.entries(byVert).filter(([, s]) => s.sent >= 3).map(([v, s]) => ({ v, rate: s.replied / s.sent, sent: s.sent })).sort((a, b) => b.rate - a.rate);
    if (ranked.length > 0 && !kb.seenToday("pattern", "vertical_rates")) {
      const best = ranked[0];
      out.push({ agent: "pattern", type: "learning", signal: "info", dedupKey: "vertical_rates", text: `Learning: ${best.v} is your best-converting vertical so far (${Math.round(best.rate*100)}% reply across ${best.sent} sends). Weight prospecting toward it.` });
    }
    return out;
  }},
  cost: { name: "Cost Sentinel", scan: (ctx) => {
    const out = [];
    const hourAgo = Date.now() - 3600000;
    const recent = ctx.obsLogs.filter(l => new Date(l.ts).getTime() > hourAgo);
    const spend = recent.reduce((s, l) => s + (l.costEstimate || 0), 0);
    if (spend > 0.5 && !kb.seenToday("cost", "hourly_spend")) out.push({ agent: "cost", type: "observation", signal: "warning", dedupKey: "hourly_spend", text: `AI spend hit $${spend.toFixed(2)} in the last hour. Engine stays on Haiku-first to keep this near zero.` });
    return out;
  }},
};


// How much has the engine itself spent this hour (for the cost cap).
export function engineSpendThisHour() {
  const hourAgo = Date.now() - 3600000;
  // Count both synthesis and verification — the verifier is the engine's spend too.
  return obs.getAll().filter(l => ["agent_synthesis", "agent_verify"].includes(l.fn) && new Date(l.ts).getTime() > hourAgo).reduce((s, l) => s + (l.costEstimate || 0), 0);
}


// A stable hash of the state the synthesizer cares about — skip synthesis if unchanged.
export function stateHash(cards) {
  const sig = cards.map(c => `${c.id}:${c.status}`).sort().join("|");
  let h = 0; for (let i = 0; i < sig.length; i++) { h = ((h << 5) - h + sig.charCodeAt(i)) | 0; }
  return String(h);
}


// The one paid operation — distills accumulated observations into a crisp insight.
// Batched (one call for the whole roster), Haiku by default, logged to obs so it
// shows up in your Ops cost tracking. Returns null on any failure (fails safe).
export async function synthesizeInsight(recentObs, allowSonnet, goalLine = "") {
  if (!recentObs || recentObs.length === 0) return null;
  const model = allowSonnet ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
  const bullets = recentObs.slice(0, 12).map(o => `- [${o.agent}] ${o.text}`).join("\n");
  const prompt = `You are the strategist for a paid-search outreach operation. ${goalLine}Your agents observed the following about the current pipeline. In 1-2 sentences, name the single highest-leverage move right now. Be specific and actionable. No preamble.\n\n${bullets}`;
  const r = await callClaude({ model, max_tokens: 200, messages: [{ role: "user", content: prompt }], fn: "agent_synthesis", promptChars: prompt.length });
  return r.text;
}


// ── The living engine. Mounted once at app root so it ticks regardless of tab.
//    Polls control flags every 2s (responsive pause); does free heuristic work on
//    the cadence; fires synthesis only when every lock opens. ──
// ── Loop upgrade A: the verifier (maker/checker split) ───────────────────────
// The Synthesizer (maker) writes an insight; this verifier (checker) — a separate
// call with skeptical instructions, on the stronger model — grades it against the
// actual pipeline facts before it reaches you. Per loop-engineering: the model that
// wrote the homework shouldn't be the one grading it.
export async function verifyInsight(insight, factsBlock) {
  if (!insight) return null;
  const model = "claude-sonnet-4-6"; // the checker is where stronger reasoning earns its keep
  const prompt = `You are a skeptical reviewer auditing a claim made by another AI agent about a sales pipeline. Here are the ACTUAL pipeline facts:

${factsBlock}

The agent's claimed insight:
"${insight}"

Check it against the facts. Respond ONLY with valid JSON, no preamble:
{
  "verdict": "pass" | "weak" | "reject",
  "confidence": 0-100,
  "note": "one short sentence — if weak/reject, say what's wrong or unverifiable; if pass, leave empty"
}
- pass: factually supported by the data AND genuinely the highest-leverage move.
- weak: plausible but partly unverifiable, or not clearly the best move.
- reject: contradicted by the data, or not actionable.`;
  const r = await callClaude({ model, max_tokens: 150, messages: [{ role: "user", content: prompt }], fn: "agent_verify", promptChars: prompt.length });
  if (!r.text) return null;
  try { return JSON.parse(r.text.replace(/```json|```/g, "").trim()); } catch { return null; }
}


// Compact factual snapshot the verifier checks against (pure data, no model).
export function buildFactsBlock(cards) {
  const byStatus = {};
  cards.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
  const adsLive = cards.filter(c => c.prospect?.ads_detected && !["rejected","snoozed"].includes(c.status)).length;
  const highValue = cards.filter(c => estimateValue(c).monthly >= 1500 && c.status === "prospected").length;
  const pipelineVal = pipelineValue(cards.filter(c => !["rejected","snoozed"].includes(c.status)));
  return [
    `Pipeline by status: ${Object.entries(byStatus).map(([s, n]) => `${s}=${n}`).join(", ") || "empty"}`,
    `Ads-live prospects (active): ${adsLive}`,
    `High-value untouched prospects: ${highValue}`,
    `Total pipeline value at stake: $${pipelineVal}/mo`,
  ].join("\n");
}


// ── Loop upgrade B: goal-mode ────────────────────────────────────────────────
// A goal gives the loop a direction. Progress is computed from data (free); the
// engine frames its work around closing the gap instead of just observing.
export const GOAL_TYPES = {
  replies:   { label: "Get N prospects to replied", measure: (cards) => cards.filter(c => ["replied","meeting"].includes(c.status)).length, unit: "replies" },
  meetings:  { label: "Book N meetings", measure: (cards) => cards.filter(c => c.status === "meeting").length, unit: "meetings" },
  clear_drafts: { label: "Clear all drafts (send them)", measure: (cards) => -cards.filter(c => ["draft","draft_ready"].includes(c.status)).length, unit: "drafts left", invert: true },
  send: { label: "Send N cold emails", measure: (cards) => cards.filter(c => ["sent","replied","meeting"].includes(c.status)).length, unit: "sent" },
};


export function goalProgress(cards) {
  const goal = sm.get("engine_goal");
  if (!goal || !goal.type || !GOAL_TYPES[goal.type]) return null;
  const def = GOAL_TYPES[goal.type];
  const current = def.measure(cards);
  const target = goal.target || 5;
  if (def.invert) {
    const left = -current; // current is negative count of drafts
    return { label: def.label, current: Math.max(0, target - left), target, pct: left === 0 ? 100 : Math.round(Math.max(0, (target - left) / target) * 100), unit: def.unit, done: left === 0, raw: left };
  }
  return { label: def.label, current, target, pct: Math.min(100, Math.round((current / target) * 100)), unit: def.unit, done: current >= target };
}


export function AgentEngine({ cards }) {
  const cardsRef = useRef(cards);
  useEffect(() => { cardsRef.current = cards; }, [cards]);

  useEffect(() => {
    // Track user activity for idle auto-pause.
    const onAct = () => markActivity();
    window.addEventListener("mousemove", onAct, { passive: true });
    window.addEventListener("keydown", onAct, { passive: true });
    markActivity();

    let lastWork = 0;
    const poll = setInterval(async () => {
      const ctrl = eng.get();
      if (!ctrl.running) return;                       // paused → do nothing (truly idle)
      if (ctrl.pauseWhenIdle && isIdle(ctrl.idleMin)) { // away → auto-pause
        eng.set({ running: false });
        kb.add([{ agent: "system", type: "system", signal: "info", text: "Auto-paused — no activity detected. Press play to resume." }]);
        return;
      }
      const now = Date.now();
      const forced = sm.get("engine_force_pass");
      if (!forced && now - lastWork < ctrl.cadenceSec * 1000) return; // not time for a work pass yet
      if (forced) sm.del("engine_force_pass");
      lastWork = now;

      // ── FREE heuristic pass ──
      sm.set("engine_pass_count", (sm.get("engine_pass_count") || 0) + 1);
      sm.set("engine_last_pass_forced", !!forced);
      const ctx = { cards: cardsRef.current || [], obsLogs: obs.getAll(), analyses: sm.keys("analysis_").map(k => sm.get(`analysis_${k}`)).filter(Boolean) };
      let newObs = [];
      Object.entries(HEURISTIC_AGENTS).forEach(([key, agent]) => {
        if (ctrl.agents[key] === false) return;
        try { newObs = newObs.concat(agent.scan(ctx) || []); } catch {}
      });
      const added = kb.add(newObs);
      sm.set("engine_last_tick", now);
      if (added > 0) sm.set("engine_obs_since_synth", (sm.get("engine_obs_since_synth") || 0) + added);
      // Forced (manual) passes always confirm, so "Run pass now" gives visible feedback
      // even when the heuristics found nothing new this cycle.
      if (forced && added === 0) {
        kb.add([{ agent: "system", type: "system", signal: "info", text: `Manual pass #${sm.get("engine_pass_count")} complete — scanned ${ctx.cards.length} prospects, nothing new to flag right now.` }]);
      }

      // ── PAID synthesis — only if every lock opens ──
      if (ctrl.observeOnly) return;                                   // lock 1: observe-only
      const sinceSynth = sm.get("engine_obs_since_synth") || 0;
      if (sinceSynth < 3) return;                                     // lock 2: accumulation threshold
      const lastSynth = sm.get("engine_last_synth_ts") || 0;
      if (now - lastSynth < ctrl.synthEveryMin * 60000) return;       // lock 3: cadence
      const hash = stateHash(ctx.cards);
      if (hash === sm.get("engine_last_synth_hash")) return;          // lock 4: nothing changed
      if (engineSpendThisHour() >= ctrl.hourlyCostCap) {              // lock 5: cost cap
        eng.set({ observeOnly: true });
        kb.add([{ agent: "system", type: "system", signal: "warning", text: `Hourly cost cap ($${ctrl.hourlyCostCap}) reached — dropped to observe-only. Free heuristics keep running.` }]);
        return;
      }
      // All locks open → one batched call (the "maker").
      const recent = kb.all().filter(e => e.type === "observation" || e.type === "learning").slice(0, 12);
      // Goal-mode: prepend the current goal so synthesis aims at closing the gap.
      const gp = ctrl.goalMode ? goalProgress(ctx.cards) : null;
      const goalLine = gp ? `CURRENT GOAL: ${gp.label} — ${gp.current}/${gp.target} ${gp.unit} (${gp.pct}%). Frame the move around closing this gap.

` : "";
      const insight = await synthesizeInsight(recent, ctrl.allowSonnet, goalLine);
      sm.set("engine_last_synth_ts", now);
      sm.set("engine_last_synth_hash", hash);
      sm.set("engine_obs_since_synth", 0);
      if (insight) {
        // Loop upgrade A: a separate checker verifies the insight before it ships.
        let signal = "info", verify = null;
        if (ctrl.verifyInsights) {
          verify = await verifyInsight(insight, buildFactsBlock(ctx.cards));
          if (verify) {
            if (verify.verdict === "reject") signal = "rejected";
            else if (verify.verdict === "weak") signal = "weak";
          }
        }
        if (signal !== "rejected") {
          kb.add([{ agent: "synthesizer", type: "insight", signal: signal === "info" ? "info" : signal, text: insight, verified: verify ? verify.verdict : null, confidence: verify ? verify.confidence : null, verifyNote: verify?.note || null }]);
        } else {
          // Rejected insights are logged quietly as system notes, not shown as insights.
          kb.add([{ agent: "synthesizer", type: "system", signal: "warning", text: `Insight rejected by verifier: ${verify?.note || "contradicted by pipeline data"}` }]);
        }
      }
    }, 2000);

    return () => { clearInterval(poll); window.removeEventListener("mousemove", onAct); window.removeEventListener("keydown", onAct); };
  }, []);

  return null; // headless
}
