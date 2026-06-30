import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";

// ════════════════════════════════════════════════════════════════════════════
// ZERO TO SECURE — Creator outreach + Shorts production command center.
// Built on the Clarify architecture (agent engine, premium design, pipeline
// mechanics) but native to ZTS: YouTube creators instead of local businesses,
// and a Shorts production Studio as a co-equal pillar.
// ════════════════════════════════════════════════════════════════════════════

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";
const YOUTUBE_API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY || "";

const MODEL_PRICING = {
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
};
function estimateCost(model, inTok, outTok) {
  const p = MODEL_PRICING[model] || MODEL_PRICING["claude-haiku-4-5-20251001"];
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

// ─── Persistence helpers (localStorage-backed stores) ────────────────────────
const sm = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(`zts_${k}`)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`zts_${k}`, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(`zts_${k}`); } catch {} },
  keys: (prefix) => { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(`zts_${prefix}`)) out.push(k.replace(`zts_${prefix}`, "")); } return out; },
};

// Observability log (mirrors Clarify's Ops)
const obs = {
  getAll: () => sm.get("obs_log") || [],
  log: (entry) => { const e = { id: `${Date.now()}_${Math.random().toString(36).slice(2,6)}`, ts: new Date().toISOString(), ...entry }; sm.set("obs_log", [e, ...(sm.get("obs_log") || [])].slice(0, 500)); },
  clear: () => sm.set("obs_log", []),
};

// ─── Claude call (shared) ────────────────────────────────────────────────────
async function callClaude({ system, messages, model = "claude-haiku-4-5-20251001", maxTokens = 1024, fn = "generate" }) {
  const t0 = Date.now();
  try {
    const isDeployed = window.location.hostname !== "localhost";
    const url = isDeployed ? "/.netlify/functions/claude" : "https://api.anthropic.com/v1/messages";
    const headers = isDeployed
      ? { "Content-Type": "application/json" }
      : { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
    const body = { model, max_tokens: maxTokens, messages };
    if (system) body.system = system;
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json();
    const text = data.content?.map(b => b.type === "text" ? b.text : "").join("") || "";
    const inTok = data.usage?.input_tokens || Math.round(JSON.stringify(messages).length / 4);
    const outTok = data.usage?.output_tokens || Math.round(text.length / 4);
    obs.log({ fn, model, inputTokens: inTok, outputTokens: outTok, costEstimate: estimateCost(model, inTok, outTok), latencyMs: Date.now() - t0, ok: !!text });
    return text;
  } catch (e) {
    obs.log({ fn, model, ok: false, latencyMs: Date.now() - t0 });
    return null;
  }
}

// ─── ZTS domain: creator-fit value model ─────────────────────────────────────
// Unlike Clarify's monthly retainer, a creator's value to ZTS is audience reach
// weighted by how relevant their niche is to Bitcoin self-custody and how engaged
// their audience is. A 50k-sub Bitcoin-privacy channel beats a 500k general-tech one.
const NICHE_FIT = [
  { match: ["self custody","self-custody","hardware wallet","seed phrase","cold storage","privacy"], weight: 1.0, label: "Self-Custody" },
  { match: ["bitcoin","btc","satoshi","lightning"], weight: 0.9, label: "Bitcoin" },
  { match: ["crypto","cryptocurrency","altcoin","ethereum","defi"], weight: 0.6, label: "Crypto" },
  { match: ["finance","investing","money","wealth"], weight: 0.4, label: "Finance" },
  { match: ["tech","security","cybersecurity","privacy tech"], weight: 0.5, label: "Tech/Security" },
];
function nicheFit(creator) {
  const text = `${creator.channel_name || ""} ${creator.niche || ""} ${creator.description || ""}`.toLowerCase();
  const hit = NICHE_FIT.find(n => n.match.some(m => text.includes(m)));
  return hit || { weight: 0.25, label: "General" };
}
function creatorValue(creator) {
  const subs = creator.subscriber_count || 0;
  const fit = nicheFit(creator);
  const engagement = creator.engagement_rate != null ? creator.engagement_rate : 0.04; // default 4%
  // Reach-value: effective engaged audience in the right niche.
  const score = Math.round(subs * fit.weight * Math.min(engagement / 0.04, 2.5));
  return { score, fitLabel: fit.label, fitWeight: fit.weight, tier: score >= 40000 ? "Prime" : score >= 12000 ? "Strong" : score >= 3000 ? "Fit" : "Light" };
}
function fmtSubs(n) {
  if (!n) return "0";
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}
// ─── Premium design system (inherited from Clarify's redesign) ───────────────
function useGlobalStyles() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap";
    document.head.appendChild(link);
    const style = document.createElement("style");
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; }
      * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
      html, body { margin: 0; font-family: 'Inter', system-ui, sans-serif; }
      body { background-color: #F4F5F8; background-image: radial-gradient(1200px 600px at 12% -8%, rgba(245,158,11,0.05), transparent 60%), radial-gradient(1000px 700px at 100% 0%, rgba(14,159,110,0.045), transparent 55%); background-attachment: fixed; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(15,23,42,0.12); border-radius: 10px; border: 2px solid transparent; background-clip: padding-box; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(15,23,42,0.22); background-clip: padding-box; }
      textarea, input, select, button { font-family: 'Inter', system-ui, sans-serif; }
      ::selection { background: rgba(245,158,11,0.22); color: #0B1220; }
      button, a, [role="button"], input, select, textarea { transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease, transform 0.12s ease, opacity 0.16s ease; }
      button:not(:disabled):active { transform: translateY(0.5px); }
      button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245,158,11,0.32); }
      input::placeholder, textarea::placeholder { color: #9AA6B6; }
      @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
      @keyframes fadein { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }, []);
}

// ZTS palette: emerald/secure-green primary, deep navy, amber accent.
const T = {
  bg: "transparent", ink: "#0B1220", sub: "#64748B", faint: "#8A97A8",
  green: "#0E9F6E", greenDeep: "#0A7A54", amber: "#F59E0B", amberDeep: "#B68A2E",
  navy: "#0B1120", blue: "#3B82F6", red: "#DC2626", purple: "#7C3AED",
  card: "#FFFFFF", line: "rgba(15,23,42,0.06)",
  cardShadow: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.04), 0 0 0 1px rgba(15,23,42,0.02)",
  navyGrad: "linear-gradient(135deg, #16233B 0%, #0B1120 100%)",
};
const syne = "'Syne', system-ui";
const mono = "'DM Mono', monospace";

const Card = ({ children, style, onClick, hover }) => (
  <div onClick={onClick}
    onMouseEnter={hover ? (e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 8px rgba(15,23,42,0.06), 0 16px 40px rgba(15,23,42,0.08)"; } : undefined}
    onMouseLeave={hover ? (e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = T.cardShadow; } : undefined}
    style={{ background: T.card, borderRadius: "16px", border: `1px solid ${T.line}`, boxShadow: T.cardShadow, padding: "18px 20px", cursor: onClick ? "pointer" : "default", ...style }}>{children}</div>
);
const Label = ({ children, style }) => <div style={{ fontSize: "11px", fontWeight: 700, color: T.sub, textTransform: "uppercase", letterSpacing: "0.13em", fontFamily: syne, ...style }}>{children}</div>;
const Btn = ({ children, onClick, primary, disabled, style }) => (
  <button onClick={onClick} disabled={disabled}
    style={{ padding: "10px 18px", background: disabled ? "rgba(15,23,42,0.06)" : primary ? T.navyGrad : "transparent", border: primary ? "1px solid rgba(245,158,11,0.2)" : `1px solid ${T.line}`, borderRadius: "10px", color: disabled ? T.faint : primary ? "#FFFFFF" : T.sub, fontSize: "12px", fontWeight: 700, cursor: disabled ? "default" : "pointer", fontFamily: syne, letterSpacing: "0.02em", ...style }}>{children}</button>
);
// ════════════════════════════════════════════════════════════════════════════
// STUDIO — Shorts production. Each Short moves: idea → script → assets → ready →
// posted. Claude generates the assets live; the three Short types frame the angle.
// ════════════════════════════════════════════════════════════════════════════

const SHORT_TYPES = {
  angle: {
    label: "ZTS Angle",
    desc: "Repeatable self-custody truths — 'not your keys', exchange risk, sovereignty.",
    systemHint: "Draw on the ZTS angle library: 'not your keys, not your coins', exchange collapses (FTX, Mt. Gox, Celsius), the case for cold storage, sovereignty and self-reliance. Punchy, conviction-driven, slightly contrarian.",
  },
  news: {
    label: "Newsjack",
    desc: "React to a current crypto event — hack, collapse, regulation, price move.",
    systemHint: "React to a specific current event the user provides. Open with the news hook, pivot fast to the self-custody lesson. Timely and urgent without being alarmist.",
  },
  educational: {
    label: "Educational",
    desc: "Explain how self-custody works — seed phrases, backups, threat models.",
    systemHint: "Teach one concrete self-custody concept clearly and simply (seed phrase backup, metal vs paper, passphrase, inheritance planning). Calm, credible, beginner-friendly.",
  },
};

const ZTS_BRAND = `Zero To Secure (ZTS) sells a premium stainless-steel seed phrase backup kit for Bitcoin self-custody. Brand voice: confident, sovereign, no-nonsense, security-first, respects the viewer's intelligence. Core belief: people locked out of traditional systems deserve real control over their own money. Never fear-monger cheaply; lead with empowerment. Audience: Bitcoin holders who are serious about not losing their coins to exchange failure, hacks, or their own mistakes.`;

// Generate a full Shorts asset package in one structured call.
async function generateShort({ type, topic, creatorContext, model = "claude-haiku-4-5-20251001" }) {
  const t = SHORT_TYPES[type] || SHORT_TYPES.angle;
  const system = `You are the head of short-form content for Zero To Secure. ${ZTS_BRAND}

You are writing a YouTube Short (under 60 seconds, ~140-160 words of spoken script). ${t.systemHint}

Respond ONLY with valid JSON, no preamble or markdown fences:
{
  "hook": "the first 3 seconds — a scroll-stopping spoken line",
  "script": "the full spoken script, ~140-160 words, punchy short sentences, written to be read aloud, with natural pauses",
  "thumbnail_concepts": [
    { "visual": "what's on screen", "text_overlay": "3-5 words max, bold" },
    { "visual": "alternate concept", "text_overlay": "3-5 words max" }
  ],
  "title": "YouTube title, under 60 chars, high-CTR, no clickbait lies",
  "description": "2-3 line description with a soft CTA to ZTS",
  "tags": ["8-12 relevant tags"],
  "pinned_comment": "a comment to pin that drives engagement or the ZTS link"
}`;
  const userMsg = `Short type: ${t.label}\nTopic / angle: ${topic || "(choose a strong one for this type)"}${creatorContext ? `\nThis Short is for a collab with: ${creatorContext}` : ""}`;
  const raw = await callClaude({ system, messages: [{ role: "user", content: userMsg }], model, maxTokens: 1400, fn: "generate_short" });
  if (!raw) return null;
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch { return null; }
}

// Regenerate a single asset (when the user wants just a new title, or new thumbnails).
async function regenAsset({ asset, short, type, model = "claude-haiku-4-5-20251001" }) {
  const t = SHORT_TYPES[type] || SHORT_TYPES.angle;
  const assetSpec = {
    title: 'Respond ONLY with JSON: {"title": "..."} — a fresh high-CTR title under 60 chars.',
    thumbnail_concepts: 'Respond ONLY with JSON: {"thumbnail_concepts": [{"visual":"...","text_overlay":"..."},{"visual":"...","text_overlay":"..."}]}',
    hook: 'Respond ONLY with JSON: {"hook": "..."} — a new scroll-stopping opening line.',
    description: 'Respond ONLY with JSON: {"description":"...","tags":["..."]}',
  }[asset];
  const system = `You are the head of short-form content for Zero To Secure. ${ZTS_BRAND} ${t.systemHint} ${assetSpec}`;
  const userMsg = `Existing script:\n${short.script || short.topic || ""}\n\nGive a fresh ${asset.replace("_", " ")}.`;
  const raw = await callClaude({ system, messages: [{ role: "user", content: userMsg }], model, maxTokens: 600, fn: "regen_asset" });
  if (!raw) return null;
  try { return JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch { return null; }
}

const SHORT_STAGES = [
  { key: "idea", label: "Idea", color: "#8A97A8" },
  { key: "script", label: "Script", color: "#B68A2E" },
  { key: "assets", label: "Assets", color: "#3B82F6" },
  { key: "ready", label: "Ready", color: "#0E9F6E" },
  { key: "posted", label: "Posted", color: "#7C3AED" },
];

// The publish checklist — every Short runs the same pre-flight before going live.
const PUBLISH_CHECKLIST = [
  "Script recorded & edited",
  "Thumbnail designed (1080×1920)",
  "Title finalized (under 60 chars)",
  "Description + ZTS link added",
  "Tags added",
  "Pinned comment ready",
  "Captions / subtitles on",
  "Scheduled or posted",
];
// ════════════════════════════════════════════════════════════════════════════
// AGENT ENGINE — same two-speed design as Clarify: free heuristic heartbeat,
// rare gated synthesis. ZTS-native watchers cover BOTH pillars (creators + studio).
// ════════════════════════════════════════════════════════════════════════════
const ENGINE_DEFAULTS = {
  running: false, observeOnly: true, cadenceSec: 20, synthEveryMin: 30,
  hourlyCostCap: 0.25, pauseWhenIdle: true, idleMin: 10, allowSonnet: false,
  agents: { creatorScout: true, production: true, cadence: true, reply: true, pattern: true, cost: true },
};
const eng = {
  get: () => ({ ...ENGINE_DEFAULTS, ...(sm.get("engine_ctrl") || {}), agents: { ...ENGINE_DEFAULTS.agents, ...((sm.get("engine_ctrl") || {}).agents || {}) } }),
  set: (patch) => sm.set("engine_ctrl", { ...eng.get(), ...patch }),
  setAgent: (key, on) => { const c = eng.get(); eng.set({ agents: { ...c.agents, [key]: on } }); },
};
const kb = {
  all: () => sm.get("agent_kb") || [],
  add: (entries) => { if (!entries || !entries.length) return 0; const ex = sm.get("agent_kb") || []; const stamped = entries.map(e => ({ id: `${Date.now()}_${Math.random().toString(36).slice(2,6)}`, ts: new Date().toISOString(), ...e })); sm.set("agent_kb", [...stamped, ...ex].slice(0, 400)); return stamped.length; },
  clear: () => sm.set("agent_kb", []),
  seenToday: (agent, key) => { const t = new Date().toISOString().slice(0,10); return (sm.get("agent_kb") || []).some(e => e.agent === agent && e.dedupKey === key && (e.ts||"").slice(0,10) === t); },
};
function markActivity() { sm.set("engine_last_activity", Date.now()); }
function isIdle(min) { const last = sm.get("engine_last_activity") || Date.now(); return (Date.now() - last) > min * 60000; }

// Heuristic watchers — pure JS, zero cost. Cover creators AND studio production.
const HEURISTIC_AGENTS = {
  creatorScout: { name: "Creator Scout", scan: (ctx) => {
    const out = [];
    const primeIdle = ctx.creators.filter(c => c.status === "prospected" && creatorValue(c).tier === "Prime");
    if (primeIdle.length > 0 && !kb.seenToday("creatorScout", "prime_idle")) {
      const top = primeIdle.sort((a,b) => creatorValue(b).score - creatorValue(a).score)[0];
      out.push({ agent: "creatorScout", type: "observation", signal: "warning", dedupKey: "prime_idle", text: `${primeIdle.length} Prime-fit creator${primeIdle.length!==1?"s":""} un-contacted. Top: ${top.channel_name} (${fmtSubs(top.subscriber_count)} subs, ${creatorValue(top).fitLabel}). These convert best for ZTS — reach out first.` });
    }
    return out;
  }},
  production: { name: "Production Watcher", scan: (ctx) => {
    const out = [];
    const stuck = ctx.shorts.filter(s => s.stage === "script" || s.stage === "assets");
    if (stuck.length >= 3 && !kb.seenToday("production", "wip_pileup")) out.push({ agent: "production", type: "observation", signal: "info", dedupKey: "wip_pileup", text: `${stuck.length} Shorts are mid-production (script/assets). Batching the finish step keeps your posting cadence alive.` });
    const ready = ctx.shorts.filter(s => s.stage === "ready").length;
    if (ready >= 2 && !kb.seenToday("production", "ready_queue")) out.push({ agent: "production", type: "observation", signal: "warning", dedupKey: "ready_queue", text: `${ready} Shorts are READY to post but not scheduled. Get them on the calendar — published beats perfect.` });
    return out;
  }},
  cadence: { name: "Cadence Monitor", scan: (ctx) => {
    const out = [];
    const posted = ctx.shorts.filter(s => s.stage === "posted" && s.posted_at);
    if (posted.length > 0) {
      const last = posted.sort((a,b) => new Date(b.posted_at) - new Date(a.posted_at))[0];
      const days = Math.floor((Date.now() - new Date(last.posted_at).getTime()) / 86400000);
      if (days >= 3 && !kb.seenToday("cadence", "posting_gap")) out.push({ agent: "cadence", type: "observation", signal: "warning", dedupKey: "posting_gap", text: `${days} days since your last Short went live. The algorithm rewards consistency — ship one today.` });
    }
    return out;
  }},
  reply: { name: "Reply Sentinel", scan: (ctx) => {
    const out = [];
    const replies = ctx.creators.filter(c => c.status === "replied");
    if (replies.length > 0 && !kb.seenToday("reply", "creator_replies")) out.push({ agent: "reply", type: "observation", signal: "critical", dedupKey: "creator_replies", text: `${replies.length} creator repl${replies.length!==1?"ies":"y"} waiting. Warm collab interest goes cold fast — respond before anything else.` });
    return out;
  }},
  pattern: { name: "Pattern Learner", scan: (ctx) => {
    const out = [];
    const posted = ctx.shorts.filter(s => s.stage === "posted");
    if (posted.length < 4) return out;
    const byType = {};
    posted.forEach(s => { const t = s.type || "angle"; if (!byType[t]) byType[t] = 0; byType[t]++; });
    const top = Object.entries(byType).sort((a,b) => b[1]-a[1])[0];
    if (top && !kb.seenToday("pattern", "type_mix")) out.push({ agent: "pattern", type: "learning", signal: "info", dedupKey: "type_mix", text: `Learning: ${SHORT_TYPES[top[0]]?.label || top[0]} is your most-produced Short type (${top[1]} posted). Watch which type actually drives ZTS clicks and lean in.` });
    return out;
  }},
  cost: { name: "Cost Sentinel", scan: (ctx) => {
    const out = [];
    const hourAgo = Date.now() - 3600000;
    const spend = ctx.obsLogs.filter(l => new Date(l.ts).getTime() > hourAgo).reduce((s,l) => s + (l.costEstimate||0), 0);
    if (spend > 0.5 && !kb.seenToday("cost", "spend")) out.push({ agent: "cost", type: "observation", signal: "warning", dedupKey: "spend", text: `AI spend hit $${spend.toFixed(2)} this hour. Generation runs on Haiku-first to keep this low.` });
    return out;
  }},
};

const AGENT_META = [
  { key: "creatorScout", name: "Creator Scout", role: "Outreach prioritization", watches: "Prime-fit creators (high subs × niche relevance × engagement) sitting un-contacted. Surfaces the highest-value collab targets for ZTS first.", cost: "Free heuristic" },
  { key: "production", name: "Production Watcher", role: "Studio throughput", watches: "Shorts stuck mid-production and finished Shorts not yet scheduled. Keeps the content pipeline flowing so you actually ship.", cost: "Free heuristic" },
  { key: "cadence", name: "Cadence Monitor", role: "Posting consistency", watches: "Days since your last Short went live. Flags posting gaps because the algorithm rewards consistency.", cost: "Free heuristic" },
  { key: "reply", name: "Reply Sentinel", role: "Collab triage", watches: "Creator replies waiting on you. Raises a critical flag so warm collab interest never goes cold.", cost: "Free heuristic" },
  { key: "pattern", name: "Pattern Learner", role: "Content learning", watches: "Which Short types you produce most, building toward which ones actually drive ZTS conversions.", cost: "Free heuristic" },
  { key: "cost", name: "Cost Sentinel", role: "Spend guardrail", watches: "AI generation spend over the last hour. Keeps the engine honest on token cost.", cost: "Free heuristic" },
  { key: "synthesizer", name: "Synthesizer", role: "Insight distillation", watches: "Accumulated observations from every agent. Occasionally distills them into one highest-leverage move across creators + studio. The only agent that spends tokens.", cost: "Haiku · gated" },
];

function engineSpendThisHour() { const h = Date.now() - 3600000; return obs.getAll().filter(l => l.fn === "agent_synthesis" && new Date(l.ts).getTime() > h).reduce((s,l) => s + (l.costEstimate||0), 0); }
function stateHash(creators, shorts) { const sig = [...creators.map(c => `${c.id}:${c.status}`), ...shorts.map(s => `${s.id}:${s.stage}`)].sort().join("|"); let h = 0; for (let i=0;i<sig.length;i++){ h = ((h<<5)-h+sig.charCodeAt(i))|0; } return String(h); }

async function synthesizeInsight(recentObs, allowSonnet) {
  if (!recentObs || !recentObs.length) return null;
  const model = allowSonnet ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
  const bullets = recentObs.slice(0, 12).map(o => `- [${o.agent}] ${o.text}`).join("\n");
  const system = `You are the strategist for Zero To Secure, a Bitcoin self-custody brand running creator outreach AND a YouTube Shorts production pipeline. Your agents observed the following. In 1-2 sentences, name the single highest-leverage move right now across either pillar. Be specific and actionable. No preamble.`;
  const raw = await callClaude({ system, messages: [{ role: "user", content: bullets }], model, maxTokens: 200, fn: "agent_synthesis" });
  return raw;
}
// ─── STUDIO VIEW — the Shorts production pillar ──────────────────────────────
function StudioView({ shorts, setShorts }) {
  const [composing, setComposing] = useState(false);
  const [openShort, setOpenShort] = useState(null);

  const save = (next) => { setShorts(next); sm.set("shorts", next); };
  const addShort = (short) => { const s = { id: `s_${Date.now()}`, created_at: new Date().toISOString(), stage: "script", ...short }; save([s, ...shorts]); setComposing(false); setOpenShort(s); };
  const updateShort = (id, patch) => { const next = shorts.map(s => s.id === id ? { ...s, ...patch } : s); save(next); if (openShort?.id === id) setOpenShort({ ...openShort, ...patch }); };
  const delShort = (id) => { save(shorts.filter(s => s.id !== id)); setOpenShort(null); };

  const byStage = (k) => shorts.filter(s => s.stage === k);

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: T.ink, fontFamily: syne }}>Studio</div>
          <div style={{ fontSize: "12px", color: T.faint, marginTop: "2px" }}>Generate Shorts and every asset — script, thumbnail, title, description — then ship.</div>
        </div>
        <Btn primary onClick={() => setComposing(true)}>✦ New Short</Btn>
      </div>

      {/* Stage board */}
      {shorts.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: T.ink, fontFamily: syne, marginBottom: "8px" }}>No Shorts yet</div>
          <div style={{ fontSize: "13px", color: T.faint, marginBottom: "18px" }}>Spin up your first Short — pick a type, give a topic, and Claude drafts the whole package.</div>
          <Btn primary onClick={() => setComposing(true)}>✦ Create your first Short</Btn>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", alignItems: "start" }}>
          {SHORT_STAGES.map(stage => {
            const items = byStage(stage.key);
            return (
              <div key={stage.key}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "10px", padding: "0 2px" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: stage.color }} />
                  <span style={{ fontSize: "11px", fontWeight: 700, color: T.ink, fontFamily: syne }}>{stage.label}</span>
                  <span style={{ fontSize: "11px", color: T.faint, fontFamily: mono }}>{items.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {items.map(s => {
                    const t = SHORT_TYPES[s.type] || SHORT_TYPES.angle;
                    return (
                      <Card key={s.id} hover onClick={() => setOpenShort(s)} style={{ padding: "12px 13px", borderLeft: `3px solid ${stage.color}` }}>
                        <div style={{ display: "inline-block", fontSize: "8px", fontWeight: 700, color: T.amberDeep, background: "rgba(245,158,11,0.1)", padding: "2px 6px", borderRadius: "5px", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: syne, marginBottom: "6px" }}>{t.label}</div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: T.ink, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{s.title || s.topic || "Untitled"}</div>
                        {s.hook && <div style={{ fontSize: "10px", color: T.faint, marginTop: "4px", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{s.hook}</div>}
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {composing && <ComposeModal onClose={() => setComposing(false)} onCreate={addShort} />}
      {openShort && <ShortDetail short={openShort} onClose={() => setOpenShort(null)} onUpdate={updateShort} onDelete={delShort} />}
    </div>
  );
}

// Compose: pick type + topic, generate the full package.
function ComposeModal({ onClose, onCreate }) {
  const [type, setType] = useState("angle");
  const [topic, setTopic] = useState("");
  const [gen, setGen] = useState(false);

  const create = async () => {
    setGen(true);
    const pkg = await generateShort({ type, topic });
    setGen(false);
    if (pkg) onCreate({ type, topic, stage: "assets", ...pkg });
    else onCreate({ type, topic, stage: "idea" }); // generation failed → start as idea
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadein 0.15s ease both" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: "18px", padding: "26px 28px", width: "560px", maxWidth: "94vw", boxShadow: "0 32px 80px rgba(11,17,32,0.24)" }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: T.ink, fontFamily: syne, marginBottom: "4px" }}>New Short</div>
        <div style={{ fontSize: "12px", color: T.faint, marginBottom: "20px" }}>Pick a type and topic — Claude drafts the hook, script, thumbnails, title, description, and tags.</div>

        <Label style={{ marginBottom: "8px" }}>Short type</Label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "18px" }}>
          {Object.entries(SHORT_TYPES).map(([k, t]) => (
            <button key={k} onClick={() => setType(k)} style={{ textAlign: "left", padding: "12px 13px", background: type === k ? "rgba(14,159,110,0.07)" : "#F8FAFC", border: `1px solid ${type === k ? "rgba(14,159,110,0.35)" : T.line}`, borderRadius: "11px", cursor: "pointer" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: type === k ? T.greenDeep : T.ink, fontFamily: syne, marginBottom: "3px" }}>{t.label}</div>
              <div style={{ fontSize: "10px", color: T.faint, lineHeight: 1.4 }}>{t.desc}</div>
            </button>
          ))}
        </div>

        <Label style={{ marginBottom: "8px" }}>{type === "news" ? "What's the news / event?" : "Topic or angle (optional)"}</Label>
        <textarea value={topic} onChange={e => setTopic(e.target.value)} placeholder={type === "news" ? "e.g. another exchange just froze withdrawals…" : type === "educational" ? "e.g. why a metal backup beats paper" : "e.g. not your keys, not your coins — leave blank for Claude to pick"}
          style={{ width: "100%", minHeight: "70px", padding: "11px 13px", border: `1px solid ${T.line}`, borderRadius: "10px", fontSize: "13px", color: T.ink, resize: "vertical", lineHeight: 1.5 }} />

        <div style={{ display: "flex", gap: "8px", marginTop: "20px" }}>
          <Btn primary onClick={create} disabled={gen} style={{ flex: 1, padding: "12px" }}>{gen ? "Generating the package…" : "✦ Generate Short"}</Btn>
          <Btn onClick={onClose} style={{ padding: "12px 18px" }}>Cancel</Btn>
        </div>
        <div style={{ fontSize: "10px", color: T.faint, textAlign: "center", marginTop: "10px" }}>One Claude call drafts all assets. Runs on Haiku to stay cheap.</div>
      </div>
    </div>
  );
}
// Short detail — view/edit/regenerate every asset, run the publish checklist, advance stage.
function ShortDetail({ short, onClose, onUpdate, onDelete }) {
  const [regen, setRegen] = useState(null); // which asset is regenerating
  const [tab, setTab] = useState("assets");
  const t = SHORT_TYPES[short.type] || SHORT_TYPES.angle;
  const checklist = short.checklist || {};

  const doRegen = async (asset) => {
    setRegen(asset);
    const result = await regenAsset({ asset, short, type: short.type });
    setRegen(null);
    if (result) onUpdate(short.id, result);
  };
  const toggleCheck = (item) => { const next = { ...checklist, [item]: !checklist[item] }; onUpdate(short.id, { checklist: next }); };
  const advance = () => {
    const order = SHORT_STAGES.map(s => s.key);
    const i = order.indexOf(short.stage);
    const nextStage = order[Math.min(i + 1, order.length - 1)];
    onUpdate(short.id, { stage: nextStage, ...(nextStage === "posted" ? { posted_at: new Date().toISOString() } : {}) });
  };
  const copyAll = () => {
    const text = `TITLE: ${short.title || ""}\n\nHOOK: ${short.hook || ""}\n\nSCRIPT:\n${short.script || ""}\n\nDESCRIPTION:\n${short.description || ""}\n\nTAGS: ${(short.tags||[]).join(", ")}\n\nPINNED COMMENT: ${short.pinned_comment || ""}`;
    try { navigator.clipboard.writeText(text); } catch {}
  };

  const checkDone = PUBLISH_CHECKLIST.filter(i => checklist[i]).length;

  const AssetBlock = ({ title, asset, children }) => (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "7px" }}>
        <Label>{title}</Label>
        {asset && <button onClick={() => doRegen(asset)} disabled={regen === asset} style={{ fontSize: "10px", fontWeight: 700, color: regen === asset ? T.faint : T.greenDeep, background: "none", border: "none", cursor: regen === asset ? "default" : "pointer", fontFamily: syne }}>{regen === asset ? "↻ regenerating…" : "↻ regenerate"}</button>}
      </div>
      {children}
    </div>
  );
  const box = { background: "#F8FAFC", border: `1px solid ${T.line}`, borderRadius: "10px", padding: "12px 14px", fontSize: "13px", color: T.ink, lineHeight: 1.6, whiteSpace: "pre-wrap" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadein 0.15s ease both" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: "18px", width: "640px", maxWidth: "95vw", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 32px 80px rgba(11,17,32,0.24)", overflow: "hidden" }}>
        <div style={{ padding: "18px 24px", borderBottom: `1px solid ${T.line}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "inline-block", fontSize: "9px", fontWeight: 700, color: T.amberDeep, background: "rgba(245,158,11,0.1)", padding: "2px 7px", borderRadius: "5px", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: syne, marginBottom: "6px" }}>{t.label} · {short.stage}</div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: T.ink, fontFamily: syne, lineHeight: 1.3 }}>{short.title || short.topic || "Untitled Short"}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#CBD5E1", fontSize: "20px", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ display: "flex", gap: "4px", padding: "12px 24px 0" }}>
          {[["assets", "Assets"], ["publish", `Publish (${checkDone}/${PUBLISH_CHECKLIST.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 14px", background: tab === k ? "rgba(14,159,110,0.08)" : "transparent", border: "none", borderRadius: "8px", color: tab === k ? T.greenDeep : T.faint, fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: syne }}>{l}</button>
          ))}
        </div>

        <div style={{ padding: "18px 24px", overflowY: "auto" }}>
          {tab === "assets" ? (
            <>
              {!short.script && short.stage === "idea" ? (
                <div style={{ textAlign: "center", padding: "30px 0" }}>
                  <div style={{ fontSize: "13px", color: T.faint, marginBottom: "16px" }}>Generation didn't complete. Try again:</div>
                  <Btn primary onClick={async () => { setRegen("all"); const pkg = await generateShort({ type: short.type, topic: short.topic }); setRegen(null); if (pkg) onUpdate(short.id, { stage: "assets", ...pkg }); }}>{regen === "all" ? "Generating…" : "✦ Generate assets"}</Btn>
                </div>
              ) : (
                <>
                  <AssetBlock title="Hook (first 3 seconds)" asset="hook"><div style={box}>{short.hook || "—"}</div></AssetBlock>
                  <AssetBlock title="Script"><div style={box}>{short.script || "—"}</div></AssetBlock>
                  <AssetBlock title="Thumbnail concepts" asset="thumbnail_concepts">
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {(short.thumbnail_concepts || []).map((tc, i) => (
                        <div key={i} style={{ ...box, display: "flex", gap: "12px", alignItems: "center" }}>
                          <div style={{ flexShrink: 0, width: "70px", height: "90px", background: T.navyGrad, borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", padding: "8px", textAlign: "center" }}>
                            <span style={{ fontSize: "10px", fontWeight: 800, color: T.amber, fontFamily: syne, lineHeight: 1.1, textTransform: "uppercase" }}>{tc.text_overlay}</span>
                          </div>
                          <div style={{ fontSize: "12px", color: T.sub, lineHeight: 1.5 }}>{tc.visual}</div>
                        </div>
                      ))}
                    </div>
                  </AssetBlock>
                  <AssetBlock title="Title" asset="title"><div style={box}>{short.title || "—"}</div></AssetBlock>
                  <AssetBlock title="Description + tags" asset="description">
                    <div style={box}>{short.description || "—"}</div>
                    {(short.tags || []).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "8px" }}>{short.tags.map((tag, i) => <span key={i} style={{ fontSize: "10px", color: T.sub, background: "#F1F4FA", padding: "2px 8px", borderRadius: "12px", fontFamily: mono }}>#{tag}</span>)}</div>}
                  </AssetBlock>
                  {short.pinned_comment && <AssetBlock title="Pinned comment"><div style={box}>{short.pinned_comment}</div></AssetBlock>}
                </>
              )}
            </>
          ) : (
            <div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
                {PUBLISH_CHECKLIST.map(item => (
                  <button key={item} onClick={() => toggleCheck(item)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 13px", background: checklist[item] ? "rgba(14,159,110,0.06)" : "#F8FAFC", border: `1px solid ${checklist[item] ? "rgba(14,159,110,0.25)" : T.line}`, borderRadius: "9px", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ width: "18px", height: "18px", borderRadius: "5px", border: `1.5px solid ${checklist[item] ? T.green : "#CBD5E1"}`, background: checklist[item] ? T.green : "transparent", color: "#FFF", fontSize: "11px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{checklist[item] ? "✓" : ""}</span>
                    <span style={{ fontSize: "12px", color: checklist[item] ? T.sub : T.ink, fontWeight: 500, textDecoration: checklist[item] ? "line-through" : "none" }}>{item}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "14px 24px", borderTop: `1px solid ${T.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <button onClick={() => onDelete(short.id)} style={{ background: "none", border: "none", color: "#CBD5E1", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>Delete</button>
          <div style={{ display: "flex", gap: "8px" }}>
            <Btn onClick={copyAll}>Copy all</Btn>
            {short.stage !== "posted" && <Btn primary onClick={advance}>{short.stage === "ready" ? "Mark posted →" : "Advance stage →"}</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}
// ─── CREATORS VIEW — outreach pipeline (YouTube creators) ────────────────────
const CREATOR_STAGES = [
  { key: "prospected", label: "Prospected", color: "#8A97A8" },
  { key: "drafted", label: "Drafted", color: "#F59E0B" },
  { key: "sent", label: "Sent", color: "#3B82F6" },
  { key: "replied", label: "Replied", color: "#EC4899" },
  { key: "collab", label: "Collab", color: "#0E9F6E" },
];
function CreatorsView({ creators, setCreators }) {
  const [adding, setAdding] = useState(false);
  const [sortBy, setSortBy] = useState("value");
  const save = (next) => { setCreators(next); sm.set("creators", next); };
  const move = (id, stage) => save(creators.map(c => c.id === id ? { ...c, stage, status: stage } : c));

  const sorted = [...creators].sort((a, b) => {
    if (sortBy === "value") return creatorValue(b).score - creatorValue(a).score;
    if (sortBy === "subs") return (b.subscriber_count||0) - (a.subscriber_count||0);
    return (a.channel_name||"").localeCompare(b.channel_name||"");
  });
  const byStage = (k) => sorted.filter(c => (c.stage || "prospected") === k);
  const totalReach = creators.filter(c => !["rejected"].includes(c.stage)).reduce((s, c) => s + creatorValue(c).score, 0);

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: T.ink, fontFamily: syne }}>Creators</div>
          <div style={{ fontSize: "12px", color: T.faint, marginTop: "2px" }}>Find, contact, and track YouTube creators for ZTS collabs — prioritized by audience fit.</div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: "8px 12px", border: `1px solid ${T.line}`, borderRadius: "9px", fontSize: "12px", color: T.sub, background: "#FFF" }}>
            <option value="value">Best fit first</option>
            <option value="subs">Most subscribers</option>
            <option value="name">A → Z</option>
          </select>
          <Btn primary onClick={() => setAdding(true)}>+ Add Creator</Btn>
        </div>
      </div>

      {creators.length > 0 && (
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "16px", padding: "0 2px" }}>
          <Label>Audience-fit reach</Label>
          <span style={{ fontSize: "15px", fontWeight: 600, color: T.ink, fontFamily: mono }}>{fmtSubs(totalReach)}<span style={{ fontSize: "11px", color: T.faint }}> weighted reach in pipeline</span></span>
        </div>
      )}

      {creators.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: T.ink, fontFamily: syne, marginBottom: "8px" }}>No creators yet</div>
          <div style={{ fontSize: "13px", color: T.faint, marginBottom: "18px" }}>Add YouTube creators to start building your collab pipeline. They're auto-scored by fit to ZTS.</div>
          <Btn primary onClick={() => setAdding(true)}>+ Add your first creator</Btn>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", alignItems: "start" }}>
          {CREATOR_STAGES.map(stage => {
            const items = byStage(stage.key);
            return (
              <div key={stage.key}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "10px", padding: "0 2px" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: stage.color }} />
                  <span style={{ fontSize: "11px", fontWeight: 700, color: T.ink, fontFamily: syne }}>{stage.label}</span>
                  <span style={{ fontSize: "11px", color: T.faint, fontFamily: mono }}>{items.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {items.map(c => {
                    const v = creatorValue(c);
                    const tierColor = v.tier === "Prime" ? T.green : v.tier === "Strong" ? T.blue : v.tier === "Fit" ? T.amber : T.faint;
                    const nextStage = CREATOR_STAGES[Math.min(CREATOR_STAGES.findIndex(s => s.key === stage.key) + 1, CREATOR_STAGES.length - 1)];
                    return (
                      <Card key={c.id} style={{ padding: "12px 13px", borderLeft: `3px solid ${tierColor}` }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: T.ink, fontFamily: syne, lineHeight: 1.3 }}>{c.channel_name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "10px", color: T.sub, fontFamily: mono }}>{fmtSubs(c.subscriber_count)} subs</span>
                          <span style={{ fontSize: "9px", fontWeight: 700, color: tierColor, background: tierColor + "15", padding: "1px 6px", borderRadius: "5px", fontFamily: syne }}>{v.tier} · {v.fitLabel}</span>
                        </div>
                        {stage.key !== "collab" && <button onClick={() => move(c.id, nextStage.key)} style={{ marginTop: "8px", width: "100%", padding: "5px", background: "transparent", border: `1px solid ${T.line}`, borderRadius: "7px", fontSize: "10px", fontWeight: 700, color: T.sub, cursor: "pointer", fontFamily: syne }}>→ {nextStage.label}</button>}
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && <AddCreatorModal onClose={() => setAdding(false)} onAdd={(c) => { save([{ id: `c_${Date.now()}`, stage: "prospected", status: "prospected", created_at: new Date().toISOString(), ...c }, ...creators]); setAdding(false); }} />}
    </div>
  );
}

function AddCreatorModal({ onClose, onAdd }) {
  const [f, setF] = useState({ channel_name: "", subscriber_count: "", niche: "", description: "", engagement_rate: "" });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const submit = () => { if (!f.channel_name) return; onAdd({ ...f, subscriber_count: Number(f.subscriber_count) || 0, engagement_rate: f.engagement_rate ? Number(f.engagement_rate) / 100 : null }); };
  const v = f.channel_name ? creatorValue({ ...f, subscriber_count: Number(f.subscriber_count) || 0 }) : null;
  const input = { width: "100%", padding: "10px 12px", border: `1px solid ${T.line}`, borderRadius: "9px", fontSize: "13px", color: T.ink, marginBottom: "10px" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,18,32,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadein 0.15s ease both" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: "18px", padding: "26px 28px", width: "480px", maxWidth: "94vw", boxShadow: "0 32px 80px rgba(11,17,32,0.24)" }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: T.ink, fontFamily: syne, marginBottom: "18px" }}>Add Creator</div>
        <input placeholder="Channel name" value={f.channel_name} onChange={e => set("channel_name", e.target.value)} style={input} />
        <input placeholder="Subscriber count (e.g. 45000)" value={f.subscriber_count} onChange={e => set("subscriber_count", e.target.value)} style={input} />
        <input placeholder="Niche (e.g. Bitcoin self-custody)" value={f.niche} onChange={e => set("niche", e.target.value)} style={input} />
        <input placeholder="Engagement rate % (optional, e.g. 5)" value={f.engagement_rate} onChange={e => set("engagement_rate", e.target.value)} style={input} />
        <textarea placeholder="Channel description (helps fit scoring)" value={f.description} onChange={e => set("description", e.target.value)} style={{ ...input, minHeight: "60px", resize: "vertical" }} />
        {v && <div style={{ fontSize: "11px", color: T.sub, marginBottom: "14px", padding: "8px 12px", background: "rgba(14,159,110,0.06)", borderRadius: "8px" }}>Fit: <strong style={{ color: T.greenDeep }}>{v.tier}</strong> · {v.fitLabel} · weighted reach {fmtSubs(v.score)}</div>}
        <div style={{ display: "flex", gap: "8px" }}>
          <Btn primary onClick={submit} style={{ flex: 1, padding: "11px" }}>Add to pipeline</Btn>
          <Btn onClick={onClose} style={{ padding: "11px 18px" }}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}
// ─── AGENT ENGINE (headless) ─────────────────────────────────────────────────
function AgentEngine({ creators, shorts }) {
  const cRef = useRef(creators), sRef = useRef(shorts);
  useEffect(() => { cRef.current = creators; }, [creators]);
  useEffect(() => { sRef.current = shorts; }, [shorts]);
  useEffect(() => {
    const onAct = () => markActivity();
    window.addEventListener("mousemove", onAct, { passive: true });
    window.addEventListener("keydown", onAct, { passive: true });
    markActivity();
    let lastWork = 0;
    const poll = setInterval(async () => {
      const ctrl = eng.get();
      if (!ctrl.running) return;
      if (ctrl.pauseWhenIdle && isIdle(ctrl.idleMin)) { eng.set({ running: false }); kb.add([{ agent: "system", type: "system", signal: "info", text: "Auto-paused — no activity detected." }]); return; }
      const now = Date.now();
      const forced = sm.get("engine_force_pass");
      if (!forced && now - lastWork < ctrl.cadenceSec * 1000) return;
      if (forced) sm.del("engine_force_pass");
      lastWork = now;
      sm.set("engine_pass_count", (sm.get("engine_pass_count") || 0) + 1);
      const ctx = { creators: cRef.current || [], shorts: sRef.current || [], obsLogs: obs.getAll() };
      let newObs = [];
      Object.entries(HEURISTIC_AGENTS).forEach(([k, a]) => { if (ctrl.agents[k] === false) return; try { newObs = newObs.concat(a.scan(ctx) || []); } catch {} });
      const added = kb.add(newObs);
      sm.set("engine_last_tick", now);
      if (added > 0) sm.set("engine_obs_since_synth", (sm.get("engine_obs_since_synth") || 0) + added);
      if (forced && added === 0) kb.add([{ agent: "system", type: "system", signal: "info", text: `Manual pass #${sm.get("engine_pass_count")} — scanned ${ctx.creators.length} creators + ${ctx.shorts.length} Shorts, nothing new to flag.` }]);
      if (ctrl.observeOnly) return;
      if ((sm.get("engine_obs_since_synth") || 0) < 3) return;
      if (now - (sm.get("engine_last_synth_ts") || 0) < ctrl.synthEveryMin * 60000) return;
      const hash = stateHash(ctx.creators, ctx.shorts);
      if (hash === sm.get("engine_last_synth_hash")) return;
      if (engineSpendThisHour() >= ctrl.hourlyCostCap) { eng.set({ observeOnly: true }); kb.add([{ agent: "system", type: "system", signal: "warning", text: `Hourly cost cap reached — dropped to observe-only.` }]); return; }
      const recent = kb.all().filter(e => e.type === "observation" || e.type === "learning").slice(0, 12);
      const insight = await synthesizeInsight(recent, ctrl.allowSonnet);
      sm.set("engine_last_synth_ts", now); sm.set("engine_last_synth_hash", hash); sm.set("engine_obs_since_synth", 0);
      if (insight) kb.add([{ agent: "synthesizer", type: "insight", signal: "info", text: insight }]);
    }, 2000);
    return () => { clearInterval(poll); window.removeEventListener("mousemove", onAct); window.removeEventListener("keydown", onAct); };
  }, []);
  return null;
}

// ─── AGENTS VIEW (control panel + feed) ──────────────────────────────────────
function AgentsView() {
  const [ctrl, setCtrl] = useState(() => eng.get());
  const [feed, setFeed] = useState(() => kb.all());
  const [passFlash, setPassFlash] = useState(false);
  useEffect(() => { const iv = setInterval(() => { setCtrl(eng.get()); setFeed(kb.all()); }, 1500); return () => clearInterval(iv); }, []);
  const update = (p) => { eng.set(p); setCtrl(eng.get()); };
  const runOnce = () => { sm.set("engine_force_pass", true); eng.set({ running: true }); setCtrl(eng.get()); setPassFlash(true); setTimeout(() => setPassFlash(false), 2500); };
  const ago = (ts) => { if (!ts) return "never"; const m = Math.floor((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`; };
  const SEVC = { critical: T.red, warning: T.amber, info: T.blue, system: T.faint };

  const Toggle = ({ on, onClick, label, sub }) => (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: T.card, border: `1px solid ${T.line}`, borderRadius: "10px", cursor: "pointer" }}>
      <div><div style={{ fontSize: "12px", fontWeight: 600, color: T.ink }}>{label}</div>{sub && <div style={{ fontSize: "10px", color: T.faint, marginTop: "1px" }}>{sub}</div>}</div>
      <div style={{ width: "38px", height: "22px", borderRadius: "12px", background: on ? T.green : "rgba(15,23,42,0.12)", position: "relative", flexShrink: 0, transition: "background 0.15s" }}><div style={{ position: "absolute", top: "2px", left: on ? "18px" : "2px", width: "18px", height: "18px", borderRadius: "50%", background: "#FFF", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} /></div>
    </div>
  );
  const agentMeta = [["creatorScout","Creator Scout","Prime-fit creators un-contacted"],["production","Production Watcher","Shorts stuck or unscheduled"],["cadence","Cadence Monitor","Posting gaps"],["reply","Reply Sentinel","Creator replies waiting"],["pattern","Pattern Learner","Which Short types you produce"],["cost","Cost Sentinel","AI spend guardrail"]];

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", padding: "24px 28px" }}>
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "18px", fontWeight: 700, color: T.ink, fontFamily: syne }}>Agent Engine</div>
        <div style={{ fontSize: "12px", color: T.faint, marginTop: "2px" }}>A living roster watching creators + studio on a free heartbeat, spending tokens only when it's worth it.</div>
      </div>
      <div style={{ background: ctrl.running ? T.navyGrad : T.card, border: ctrl.running ? "none" : `1px solid ${T.line}`, borderRadius: "16px", padding: "18px 22px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", boxShadow: T.cardShadow }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button onClick={() => update({ running: !ctrl.running })} style={{ width: "52px", height: "52px", borderRadius: "50%", border: "none", background: ctrl.running ? T.green : T.navy, color: "#FFF", fontSize: "20px", cursor: "pointer", flexShrink: 0 }}>{ctrl.running ? "⏸" : "▶"}</button>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: ctrl.running ? "#FFF" : T.ink, fontFamily: syne }}>{ctrl.running ? "Running" : "Paused"}</div>
            <div style={{ fontSize: "11px", color: ctrl.running ? "#94A8C9" : T.faint, marginTop: "2px" }}>{ctrl.observeOnly ? "Observe-only · $0 spend" : "Synthesis on"} · heartbeat {ctrl.cadenceSec}s</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: "9px", fontWeight: 700, color: ctrl.running ? "#7C93C9" : T.faint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: syne }}>Passes</div><div style={{ fontSize: "13px", color: passFlash ? "#34D399" : ctrl.running ? "#E8EDF7" : T.sub, fontFamily: mono, fontWeight: passFlash ? 700 : 400 }}>{sm.get("engine_pass_count") || 0}{passFlash ? " ✓" : ""}</div></div>
          <button onClick={runOnce} style={{ padding: "9px 14px", background: ctrl.running ? "rgba(255,255,255,0.1)" : "rgba(15,23,42,0.04)", border: ctrl.running ? "1px solid rgba(255,255,255,0.2)" : `1px solid ${T.line}`, borderRadius: "9px", color: ctrl.running ? "#E8EDF7" : T.sub, fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: syne }}>⚡ Run pass now</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "16px", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <Label style={{ marginBottom: "2px" }}>Token Controls</Label>
          <Toggle on={ctrl.observeOnly} onClick={() => update({ observeOnly: !ctrl.observeOnly })} label="Observe-only" sub="Heuristics only — never spend tokens" />
          <Toggle on={ctrl.allowSonnet} onClick={() => update({ allowSonnet: !ctrl.allowSonnet })} label="Allow Sonnet" sub="Off = synthesis stays on Haiku" />
          <Toggle on={ctrl.pauseWhenIdle} onClick={() => update({ pauseWhenIdle: !ctrl.pauseWhenIdle })} label="Pause when idle" sub={`Auto-stop after ${ctrl.idleMin}m away`} />
          <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: "10px", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}><span style={{ fontSize: "12px", fontWeight: 600, color: T.ink }}>Heartbeat</span><span style={{ fontSize: "12px", color: T.sub, fontFamily: mono }}>{ctrl.cadenceSec}s</span></div>
            <input type="range" min="10" max="120" step="5" value={ctrl.cadenceSec} onChange={e => update({ cadenceSec: Number(e.target.value) })} style={{ width: "100%", accentColor: T.green }} />
          </div>
          <Label style={{ margin: "8px 0 2px" }}>Roster</Label>
          {agentMeta.map(([k, name, sub]) => <Toggle key={k} on={ctrl.agents[k] !== false} onClick={() => { eng.setAgent(k, !(ctrl.agents[k] !== false)); setCtrl(eng.get()); }} label={name} sub={sub} />)}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}><Label>Knowledge & Ideas ({feed.length})</Label>{feed.length > 0 && <button onClick={() => { kb.clear(); setFeed([]); }} style={{ background: "none", border: "none", color: "#CBD5E1", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>Clear</button>}</div>
          {feed.length === 0 ? (
            <Card style={{ textAlign: "center", padding: "40px" }}><div style={{ fontSize: "14px", fontWeight: 700, color: T.ink, fontFamily: syne, marginBottom: "8px" }}>Nothing observed yet</div><div style={{ fontSize: "13px", color: T.faint }}>Press play — the roster starts watching your creators and Shorts at zero token cost.</div></Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {feed.map(e => { const col = SEVC[e.signal] || T.faint; const ins = e.type === "insight"; return (
                <div key={e.id} style={{ background: ins ? "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)" : T.card, borderRadius: "11px", border: ins ? "1px solid rgba(245,158,11,0.3)" : `1px solid ${T.line}`, borderLeft: `3px solid ${ins ? T.amber : col}`, padding: "13px 15px", display: "flex", gap: "12px" }}>
                  <span style={{ fontSize: "9px", fontWeight: 700, color: ins ? T.amberDeep : col, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: syne, flexShrink: 0, marginTop: "2px", minWidth: "56px" }}>{ins ? "✦ Insight" : e.type === "learning" ? "Learned" : e.type === "system" ? "System" : "Observed"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "12px", color: T.ink, lineHeight: 1.55, fontWeight: ins ? 600 : 400 }}>{e.text}</div><div style={{ fontSize: "9px", color: T.faint, marginTop: "4px", fontFamily: mono }}>{e.agent} · {ago(new Date(e.ts).getTime())}</div></div>
                </div>
              ); })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// ─── MISSION — command center across both pillars ────────────────────────────
function MissionView({ creators, shorts, onNavigate }) {
  const engCtrl = eng.get();
  const kbAll = kb.all();
  const cPipe = { prospected: creators.filter(c => (c.stage||"prospected") === "prospected").length, sent: creators.filter(c => c.stage === "sent").length, replied: creators.filter(c => c.stage === "replied").length, collab: creators.filter(c => c.stage === "collab").length };
  const sPipe = { wip: shorts.filter(s => ["script","assets"].includes(s.stage)).length, ready: shorts.filter(s => s.stage === "ready").length, posted: shorts.filter(s => s.stage === "posted").length };
  const totalReach = creators.filter(c => c.stage !== "rejected").reduce((s, c) => s + creatorValue(c).score, 0);
  const roster = AGENT_META.map(m => { const notes = kbAll.filter(e => e.agent === m.key); const enabled = m.key === "synthesizer" ? !engCtrl.observeOnly : engCtrl.agents[m.key] !== false; return { key: m.key, name: m.name, enabled, notes: notes.length }; });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const recent = obs.getAll().slice(0, 6);

  const Stat = ({ label, value, sub, accent }) => (
    <Card><Label style={{ marginBottom: "10px" }}>{label}</Label><div style={{ fontSize: "26px", fontWeight: 500, color: accent || T.ink, fontFamily: mono, lineHeight: 1 }}>{value}</div>{sub && <div style={{ fontSize: "10px", color: T.faint, marginTop: "6px" }}>{sub}</div>}</Card>
  );

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "18px" }}>
        <div>
          <div style={{ fontSize: "24px", fontWeight: 700, color: T.ink, fontFamily: syne }}>{greeting}, Cameron</div>
          <div style={{ fontSize: "12px", color: T.faint, marginTop: "2px" }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Zero To Secure</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: T.green, fontWeight: 600 }}><span style={{ width: "7px", height: "7px", borderRadius: "50%", background: T.green }} />Live</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "16px" }}>
        <Card>
          <Label style={{ marginBottom: "12px" }}>Creator Pipeline</Label>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            {[["Prospected", cPipe.prospected, T.faint], ["Sent", cPipe.sent, T.blue], ["Replied", cPipe.replied, "#EC4899"], ["Collab", cPipe.collab, T.green]].map(([l, v, c], i) => (
              <div key={i} style={{ textAlign: "center" }}><div style={{ fontSize: "22px", fontWeight: 500, color: c, fontFamily: mono, lineHeight: 1 }}>{v}</div><div style={{ fontSize: "9px", color: T.faint, marginTop: "5px", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: syne, fontWeight: 700 }}>{l}</div></div>
            ))}
          </div>
          <div style={{ fontSize: "10px", color: T.faint, marginTop: "12px", textAlign: "center" }}><span style={{ color: T.green, fontWeight: 600 }}>{fmtSubs(totalReach)} weighted reach</span> in pipeline</div>
        </Card>
        <Card>
          <Label style={{ marginBottom: "12px" }}>Shorts Studio</Label>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            {[["In Production", sPipe.wip, T.amber], ["Ready", sPipe.ready, T.green], ["Posted", sPipe.posted, T.purple]].map(([l, v, c], i) => (
              <div key={i} style={{ textAlign: "center" }}><div style={{ fontSize: "22px", fontWeight: 500, color: c, fontFamily: mono, lineHeight: 1 }}>{v}</div><div style={{ fontSize: "9px", color: T.faint, marginTop: "5px", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: syne, fontWeight: 700 }}>{l}</div></div>
            ))}
          </div>
          <div style={{ fontSize: "10px", color: T.amberDeep, marginTop: "12px", textAlign: "center", cursor: "pointer", fontWeight: 600 }} onClick={() => onNavigate("studio")}>Open Studio ›</div>
        </Card>
        <Stat label="Ready to Post" value={sPipe.ready} sub={sPipe.ready > 0 ? "get them scheduled" : "none queued"} accent={sPipe.ready > 0 ? T.green : T.ink} />
        <Stat label="AI Spend" value={`$${obs.getAll().reduce((s,l) => s + (l.costEstimate||0), 0).toFixed(2)}`} sub={`${obs.getAll().length} calls`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}><Label>Agent Roster</Label><span onClick={() => onNavigate("agents")} style={{ fontSize: "10px", color: T.amberDeep, cursor: "pointer", fontWeight: 700 }}>Engine ›</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {roster.map((a, i) => { const active = a.enabled && engCtrl.running; return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "9px", padding: "9px 11px", background: "#F8FAFC", borderRadius: "9px", border: `1px solid ${T.line}` }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0, background: active ? T.green : a.enabled ? "#CBD5E1" : "#E2E8F0" }} />
                <div style={{ minWidth: 0 }}><div style={{ fontSize: "11px", fontWeight: 700, color: T.ink, fontFamily: syne, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div><div style={{ fontSize: "9px", color: T.faint }}>{a.notes > 0 ? `${a.notes} note${a.notes!==1?"s":""}` : a.enabled ? "ready" : "off"}</div></div>
              </div>
            ); })}
          </div>
        </Card>
        <Card>
          <Label style={{ marginBottom: "14px" }}>Recent Activity</Label>
          {recent.length === 0 ? <div style={{ fontSize: "12px", color: T.faint, textAlign: "center", padding: "20px 0" }}>No AI activity yet today.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              {recent.map((l, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: l.ok === false ? T.red : T.green, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "11px", color: T.ink, fontWeight: 600 }}>{({ generate_short: "Generated a Short", regen_asset: "Regenerated asset", agent_synthesis: "Engine synthesis" })[l.fn] || l.fn}</div></div>
                  <span style={{ fontSize: "10px", color: T.faint, fontFamily: mono }}>${(l.costEstimate||0).toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── OPS — observability ─────────────────────────────────────────────────────
function OpsView() {
  const [logs, setLogs] = useState(obs.getAll());
  const testLog = () => { const models = ["claude-haiku-4-5-20251001","claude-sonnet-4-6"]; const m = models[Math.floor(Math.random()*2)]; const i = 800 + Math.floor(Math.random()*3000), o = 200 + Math.floor(Math.random()*1200); obs.log({ fn: ["generate_short","regen_asset","agent_synthesis"][Math.floor(Math.random()*3)], model: m, inputTokens: i, outputTokens: o, costEstimate: estimateCost(m,i,o), latencyMs: 600+Math.floor(Math.random()*5000), ok: Math.random()>0.08 }); setLogs(obs.getAll()); };
  const total = logs.reduce((s,l) => s + (l.costEstimate||0), 0);
  const ok = logs.filter(l => l.ok !== false).length;
  return (
    <div style={{ minHeight: "calc(100vh - 52px)", padding: "24px 28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <div><div style={{ fontSize: "18px", fontWeight: 700, color: T.ink, fontFamily: syne }}>Observability</div><div style={{ fontSize: "12px", color: T.faint, marginTop: "2px" }}>Every Claude call — tokens, cost, latency, success.</div></div>
        <div style={{ display: "flex", gap: "8px" }}><Btn primary onClick={testLog}>+ Test log</Btn><Btn onClick={() => setLogs(obs.getAll())}>↻ Refresh</Btn><Btn onClick={() => { obs.clear(); setLogs([]); }}>Clear</Btn></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "16px" }}>
        {[["Total Calls", logs.length], ["Est. Cost", `$${total.toFixed(3)}`], ["Success", logs.length ? `${Math.round(ok/logs.length*100)}%` : "—"], ["Avg Latency", logs.length ? `${Math.round(logs.reduce((s,l)=>s+(l.latencyMs||0),0)/logs.length)}ms` : "—"]].map(([l, v], i) => (
          <Card key={i}><Label style={{ marginBottom: "10px" }}>{l}</Label><div style={{ fontSize: "24px", fontWeight: 500, color: T.ink, fontFamily: mono }}>{v}</div></Card>
        ))}
      </div>
      <Card>
        <Label style={{ marginBottom: "12px" }}>Run Log</Label>
        {logs.length === 0 ? <div style={{ fontSize: "13px", color: T.faint, textAlign: "center", padding: "24px 0" }}>No calls logged. Hit "Test log" to verify tracking works.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {logs.slice(0, 30).map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "9px 4px", borderBottom: i < 29 ? `1px solid ${T.line}` : "none" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: l.ok === false ? T.red : T.green, flexShrink: 0 }} />
                <span style={{ fontSize: "12px", color: T.ink, fontWeight: 600, flex: 1 }}>{l.fn}</span>
                <span style={{ fontSize: "10px", color: T.faint, fontFamily: mono }}>{l.model?.includes("sonnet") ? "Sonnet" : "Haiku"}</span>
                <span style={{ fontSize: "11px", color: T.sub, fontFamily: mono }}>{l.latencyMs}ms</span>
                <span style={{ fontSize: "11px", color: T.ink, fontFamily: mono, minWidth: "60px", textAlign: "right" }}>${(l.costEstimate||0).toFixed(4)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── APP SHELL ───────────────────────────────────────────────────────────────
export default function App() {
  useGlobalStyles();
  const [view, setView] = useState("mission");
  const [creators, setCreators] = useState(() => sm.get("creators") || []);
  const [shorts, setShorts] = useState(() => sm.get("shorts") || []);

  const TABS = ["mission", "creators", "studio", "agents", "ops"];

  return (
    <div style={{ minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <AgentEngine creators={creators} shorts={shorts} />
      <div style={{ borderBottom: `1px solid ${T.line}`, padding: "0 24px", height: "52px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "rgba(248,249,251,0.82)", backdropFilter: "blur(20px) saturate(140%)", WebkitBackdropFilter: "blur(20px) saturate(140%)", boxShadow: "0 1px 0 rgba(15,23,42,0.02), 0 4px 16px rgba(15,23,42,0.03)", zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "18px", height: "18px", borderRadius: "5px", background: "linear-gradient(135deg, #12B886 0%, #0A7A54 100%)", boxShadow: "0 1px 3px rgba(10,122,84,0.4), inset 0 1px 0 rgba(255,255,255,0.25)", display: "inline-block" }} />
            <span style={{ fontSize: "13px", fontWeight: 800, color: "#06281C", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: syne }}>Zero To Secure</span>
          </span>
          <div style={{ display: "flex", gap: "2px", background: "rgba(15,23,42,0.04)", borderRadius: "10px", padding: "3px", marginLeft: "12px", border: `1px solid rgba(15,23,42,0.04)` }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setView(t)} style={{ padding: "5px 15px", background: view === t ? "#FFFFFF" : "transparent", border: "none", borderRadius: "7px", color: view === t ? "#0B1220" : "#8A97A8", fontSize: "11px", fontWeight: 700, cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: syne, boxShadow: view === t ? "0 1px 2px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.06)" : "none" }}>{t}</button>
            ))}
          </div>
        </div>
      </div>
      {view === "mission" && <MissionView creators={creators} shorts={shorts} onNavigate={setView} />}
      {view === "creators" && <CreatorsView creators={creators} setCreators={setCreators} />}
      {view === "studio" && <StudioView shorts={shorts} setShorts={setShorts} />}
      {view === "agents" && <AgentsView />}
      {view === "ops" && <OpsView />}
    </div>
  );
}
