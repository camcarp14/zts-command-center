import { T } from "../theme.js";
import { GOVERNANCE_RULES } from "./prompts.js";
import { sm } from "./store.js";

// ════════════════════════════════════════════════════════════════════════════
// CLARIFY DNA — the genome layer. Nodes are aspects of the mind (identity,
// principles, knowledge, signals, skills, goals); edges are weighted synapses.
// The graph is FUNCTIONAL: compileGenome() deterministically turns it into the
// system prompt the DNA worker runs on, and propagate() computes the activation
// wave the canvas animates. Persistence is `sm` (localStorage) — same layer as
// the engine's kb, zero new infrastructure. The seed genome is data, not code:
// a "google_ads" genome can ship later without touching this file's logic.
// ════════════════════════════════════════════════════════════════════════════

export const GENOME_KEY = "dna_genome";

// Single region vocabulary — every consumer (canvas, view, worker) reads this.
export const REGIONS = {
  identity:  { label: "Identity",   color: T.gold,   desc: "Who Clarify is" },
  principle: { label: "Principles", color: T.violet, desc: "Rules that govern every action" },
  knowledge: { label: "Knowledge",  color: T.blue,   desc: "What it knows and has learned" },
  signal:    { label: "Signals",    color: T.amber,  desc: "Inputs it weighs when deciding" },
  skill:     { label: "Skills",     color: T.green,  desc: "Actions it can take" },
  goal:      { label: "Goals",      color: T.pink,   desc: "What it is driving toward" },
};

// Compile order is MEANING, not alphabet: who you are → what you must never do
// → what you want → what you're seeing → what you know → what you can do.
// Governance always precedes all of it (prepended verbatim in compileGenome).
export const REGION_ORDER = ["identity", "principle", "goal", "signal", "knowledge", "skill"];


// ─── small pure helpers ───────────────────────────────────────────────────────
const clamp01 = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };

// ONE truthiness rule for `enabled`, everywhere: a node is awake unless it is
// EXPLICITLY disabled. Hand-authored/imported genomes (the future google_ads
// shipping path) may omit the field — the worker, canvas, and inspector all
// read `!== false`, and the compiler/propagator/stats below MUST agree, or an
// imported mind renders fully awake while compiling to nothing.
const isAwake = (n) => !!n && n.enabled !== false;

// djb2 — the classic Bernstein hash, kept in 32-bit int math and rendered as
// unsigned hex. Tiny, dependency-free, and stable across sessions/browsers,
// which is all the "mind hash" needs to be.
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// Deterministic 0..1 "jitter" derived from the node id — the seed layout looks
// organic but two seedGenome() calls are structurally identical (testable, and
// resetting the genome doesn't reshuffle the map under you).
const jitter = (id, salt) => (parseInt(djb2(salt + id), 16) % 997) / 997;

let mutSeq = 0; // uniqueness within a single millisecond of rapid edits
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${(mutSeq++).toString(36)}`;

const slugify = (label) => String(label || "node").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "node";


// ─── seed layout — hexagonal region arrangement ──────────────────────────────
// Identity sits at the center (everything radiates from who Clarify is); the
// other five regions ring it at radius ~320, principles crowning the top.
// Nodes fan around their region anchor with deterministic jitter so the first
// paint already reads as a living thing, before physics ever runs.
const RING_R = 320;
const SPREAD_R = 92;
const RING_DEG = { principle: -90, knowledge: -18, signal: 54, skill: 126, goal: 198 };

function seedPosition(region, index, count, id) {
  const a = region === "identity" ? { x: 0, y: 0 }
    : { x: Math.cos((RING_DEG[region] * Math.PI) / 180) * RING_R, y: Math.sin((RING_DEG[region] * Math.PI) / 180) * RING_R };
  const deg = -90 + (index * 360) / count + (jitter(id, "a") - 0.5) * 26;
  const r = SPREAD_R * (0.72 + jitter(id, "r") * 0.55);
  return {
    x: Math.round(a.x + Math.cos((deg * Math.PI) / 180) * r),
    y: Math.round(a.y + Math.sin((deg * Math.PI) / 180) * r),
  };
}


// ─── the seed genome — Clarify's actual mind, mined from the codebase ────────
// Every text is a real directive: principles condense GOVERNANCE_RULES +
// ANALYST_SYSTEM_PROMPT (prompts.js), knowledge is the analyst playbook,
// signals are the heuristic agents' triggers (engine.js) + value model
// (leads.js), skills are the pipeline seams the worker actually drives.
// All six principles are LOCKED — the approval spine cannot be edited away.
const seedN = (id, label, weight, text, extra = {}) => ({ id, label, weight, text, ...extra });

const SEED_NODES = {
  identity: [
    seedN("n_id_boutique", "Boutique Chicago agency", 0.8,
      "Clarify is a boutique paid-search agency in Chicago run by Cameron. Small book, deep work — every prospect gets specific attention, never volume-blast treatment."),
    seedN("n_id_partner", "Cameron's thought partner", 0.9,
      "You are a thought partner, not an autonomous operator. The job is making Cameron's decisions faster and better-informed — never making them for him."),
    seedN("n_id_craft", "Brass-on-midnight craft", 0.7,
      "Everything shipped carries the craft standard: precise, unhurried, zero filler. If a draft reads like a template, it is not done."),
    seedN("n_id_voice", "Direct, data-led voice", 0.85,
      "Speak plainly and lead with data. Short sentences, specific numbers, no marketing fluff — and never the word 'leverage'."),
  ],
  principle: [
    seedN("n_pr_approval", "Human approval spine", 1.0,
      "Never send email or execute an account change. Every output lands as a draft in the approval queue for a human decision — no exceptions, no code path around it.", { locked: true }),
    seedN("n_pr_no_pause", "Never pause as budget lever", 0.9,
      "Never recommend pausing a campaign as a budget management tactic. Hot pacing means surgical cuts — negate bad terms, tighten schedules — never the kill switch.", { locked: true }),
    seedN("n_pr_cite", "Cite it or lower confidence", 0.95,
      "Never state a finding without the specific data point behind it. Can't cite it? Say so and lower confidence — never above 0.85 when one clarifying question would overturn it.", { locked: true }),
    seedN("n_pr_no_invent", "Never invent metrics", 0.95,
      "Never invent client data, account names, dollar figures, or metrics that were not given. When information is missing, name exactly what is missing.", { locked: true }),
    seedN("n_pr_tracking", "Tracking before diagnosis", 0.85,
      "Flag tracking and data-quality concerns before offering any performance diagnosis. Bad data produces bad decisions; widespread drops are tracking until proven otherwise.", { locked: true }),
    seedN("n_pr_cost", "Cost discipline", 0.75,
      "Run Haiku-first and respect the hourly cost caps. Spend tokens only where a free heuristic can't do the job, and log every paid call so Ops sees the bill.", { locked: true }),
  ],
  knowledge: [
    seedN("n_kn_match", "Match-type ladder", 0.7,
      "Exact match is the foundation, phrase fills gaps. Broad stays at 5-15% of keywords on proven trunk terms only — an experiment, never a default."),
    seedN("n_kn_pmax", "PMax cannibalization", 0.65,
      "PMax's primary risk is eating your own search traffic. Negate core high-intent terms from PMax and watch placement reports for display/YouTube bleed."),
    seedN("n_kn_brand_cpc", "Brand CPC inflation fix", 0.6,
      "When brand CPCs inflate: apply a max CPC cap, monitor impression share, raise tROAS if IS holds. Split Tier 1 exact from Tier 2 variants and negate across."),
    seedN("n_kn_verticals", "Vertical reply rates", 0.75,
      "Reply rate by vertical is learned from real sends — weight prospecting toward whatever converts best right now. Legal and med-spa retainers run largest ($2-2.5k/mo)."),
    seedN("n_kn_negation", "Negation philosophy", 0.6,
      "Negate what a real buyer would never search; keep anything that could reasonably convert. Efficiency negation is relative to the client's CPA target — and audit mature accounts for over-negation."),
    seedN("n_kn_bids", "Bid-strategy ladder", 0.55,
      "Max Conversions → tCPA after 30 conversions in 30 days → tROAS once value data is strong. Manual CPC is a last resort, never a starting point."),
  ],
  signal: [
    seedN("n_sg_ads_live", "Ads-live priority", 0.9,
      "Businesses already running Google Ads are the highest-intent prospects — they have budget and belief. Weight them first, always."),
    seedN("n_sg_value", "Estimated value band", 0.8,
      "Work the pipeline by money, not count. One legal or med-spa retainer outranks three standard prospects; check estimated monthly value before choosing what to touch."),
    seedN("n_sg_reply_class", "Reply classification", 0.85,
      "An interested reply is the warmest signal in the pipeline — it outranks every other queue. Read the tone before drafting anything back."),
    seedN("n_sg_cadence", "Follow-up due", 0.75,
      "Silence after one email is the #1 reason deals stall. A sent thread past its cadence window is due for a touch now, not tomorrow."),
    seedN("n_sg_email_conf", "Email confidence", 0.6,
      "Below 50% confidence a contact's email is a bounce risk — enrich or verify before drafting to it. 90%+ with a named contact is deliverable and personal."),
    seedN("n_sg_stale", "Pipeline staleness", 0.55,
      "Prospects sitting untouched 14+ days are going cold. Batch-draft or archive them before adding new volume on top."),
  ],
  skill: [
    seedN("n_sk_draft", "Draft cold outreach", 0.85,
      "Write a cold email grounded in something true about the business — their ads, their gap, their vertical. Under 120 words, one specific observation, one soft CTA to a 15-minute call."),
    seedN("n_sk_enrich", "Enrich prospect", 0.6,
      "Pull website context, find a named contact with a scored email, detect whether ads are live. Intel comes before outreach — never draft blind when enrichment is a click away."),
    seedN("n_sk_classify", "Classify reply", 0.7,
      "Read an inbound reply and grade it: scheduling, interested, objection, question, neutral, or not interested. The tier decides what gets drafted next."),
    seedN("n_sk_followup", "Draft follow-up", 0.65,
      "Write the cadence touch for a silent thread: shorter than the first email, one new angle, never guilt about the silence."),
    seedN("n_sk_strategy", "Propose strategy", 0.7,
      "Compile the evening brief: read the pipeline's real state and name the single highest-leverage move — specific and actionable, not a menu of options."),
    seedN("n_sk_grow", "Grow the mind", 0.5,
      "Scan accumulated learnings and propose new knowledge nodes for this genome — the mind rewires itself from what actually worked."),
  ],
  goal: [
    seedN("n_gl_meetings", "Book meetings", 0.9,
      "The pipeline exists to book 15-minute intro calls with qualified prospects. Every action should shorten the path to a booked meeting."),
    seedN("n_gl_replies", "Get replies", 0.8,
      "A reply — even a no — beats silence. Optimize outreach for response, not for volume sent."),
    seedN("n_gl_warm", "Keep pipeline warm", 0.7,
      "Never let the pipeline go stale: follow-ups on time, aging prospects re-touched or archived, written drafts cleared."),
    seedN("n_gl_brand", "Protect the brand", 0.85,
      "One sloppy or spammy email costs more than ten unsent ones. Clarify's name only rides on work that clears the craft bar."),
  ],
};

// Synapses. Excitatory (+1) wiring: goals prime signals, signals + knowledge
// drive skills, skills feed back into goals. Inhibitory (−1) wiring is where
// the character lives: principles and brand-protection TEMPER the action
// skills — these compile into the INTERNAL TENSIONS block, and in propagate()
// they dampen the very skills the signals are exciting.
const seedE = (from, to, weight, polarity = 1) => ({ id: `e_${from.slice(2)}_${to.slice(2)}`, from, to, weight, polarity });

const SEED_EDGES = [
  // signals → skills (what it sees drives what it does)
  seedE("n_sg_ads_live", "n_sk_draft", 0.9),
  seedE("n_sg_ads_live", "n_sk_enrich", 0.55),
  seedE("n_sg_value", "n_sk_draft", 0.8),
  seedE("n_sg_value", "n_sk_enrich", 0.5),
  seedE("n_sg_reply_class", "n_sk_classify", 0.9),
  seedE("n_sg_cadence", "n_sk_followup", 0.85),
  seedE("n_sg_stale", "n_sk_followup", 0.5),
  seedE("n_sg_stale", "n_sk_draft", 0.55),
  seedE("n_sg_stale", "n_sk_strategy", 0.4),
  seedE("n_sg_email_conf", "n_sk_draft", 0.6),
  seedE("n_sg_email_conf", "n_sk_enrich", 0.7),
  // principles ⊣/→ skills (governance tempers the doing; two excite it)
  seedE("n_pr_approval", "n_sk_draft", 0.9, -1),
  seedE("n_pr_approval", "n_sk_followup", 0.8, -1),
  seedE("n_pr_no_invent", "n_sk_draft", 0.85, -1),
  seedE("n_pr_no_invent", "n_sk_strategy", 0.7, -1),
  seedE("n_pr_cite", "n_sk_strategy", 0.75, -1),
  seedE("n_pr_no_pause", "n_sk_strategy", 0.7, -1),
  seedE("n_pr_cost", "n_sk_enrich", 0.6, -1),
  seedE("n_pr_cost", "n_sk_grow", 0.5, -1),
  seedE("n_pr_cite", "n_sk_classify", 0.5),
  seedE("n_pr_tracking", "n_sk_strategy", 0.55),
  // goals → signals (what it wants primes what it watches)
  seedE("n_gl_meetings", "n_sg_ads_live", 0.7),
  seedE("n_gl_meetings", "n_sg_value", 0.75),
  seedE("n_gl_meetings", "n_sg_cadence", 0.5),
  seedE("n_gl_replies", "n_sg_reply_class", 0.8),
  seedE("n_gl_replies", "n_sg_email_conf", 0.6),
  seedE("n_gl_warm", "n_sg_cadence", 0.8),
  seedE("n_gl_warm", "n_sg_stale", 0.75),
  seedE("n_gl_brand", "n_sg_email_conf", 0.5),
  // brand protection ⊣ volume skills (the taste gate)
  seedE("n_gl_brand", "n_sk_draft", 0.6, -1),
  seedE("n_gl_brand", "n_sk_followup", 0.45, -1),
  // knowledge → skills (the playbook informs the acts)
  seedE("n_kn_verticals", "n_sk_draft", 0.7),
  seedE("n_kn_verticals", "n_sk_enrich", 0.5),
  seedE("n_kn_verticals", "n_sk_grow", 0.6),
  seedE("n_kn_match", "n_sk_strategy", 0.6),
  seedE("n_kn_pmax", "n_sk_strategy", 0.65),
  seedE("n_kn_pmax", "n_sk_draft", 0.4),
  seedE("n_kn_pmax", "n_kn_negation", 0.4),
  seedE("n_kn_brand_cpc", "n_sk_strategy", 0.6),
  seedE("n_kn_negation", "n_sk_strategy", 0.55),
  seedE("n_kn_bids", "n_sk_strategy", 0.5),
  // identity → everything, lightly (tone soaks into all of it)
  seedE("n_id_voice", "n_sk_draft", 0.45),
  seedE("n_id_voice", "n_sk_followup", 0.4),
  seedE("n_id_voice", "n_gl_replies", 0.35),
  seedE("n_id_craft", "n_sk_draft", 0.4),
  seedE("n_id_craft", "n_gl_brand", 0.5),
  seedE("n_id_partner", "n_sk_strategy", 0.5),
  seedE("n_id_partner", "n_pr_approval", 0.4),
  seedE("n_id_boutique", "n_sg_value", 0.35),
  seedE("n_id_boutique", "n_gl_meetings", 0.3),
  // skills → goals + skill chaining (acting moves the mission)
  seedE("n_sk_draft", "n_gl_replies", 0.7),
  seedE("n_sk_draft", "n_gl_meetings", 0.65),
  seedE("n_sk_followup", "n_gl_replies", 0.6),
  seedE("n_sk_classify", "n_gl_meetings", 0.6),
  seedE("n_sk_classify", "n_sk_followup", 0.55),
  seedE("n_sk_strategy", "n_gl_meetings", 0.5),
  seedE("n_sk_enrich", "n_gl_meetings", 0.4),
  seedE("n_sk_grow", "n_kn_verticals", 0.5),
];


export function seedGenome() {
  const now = new Date().toISOString();
  const nodes = [];
  Object.entries(SEED_NODES).forEach(([region, defs]) => {
    defs.forEach((d, i) => {
      const pos = seedPosition(region, i, defs.length, d.id);
      nodes.push({
        id: d.id, label: d.label, region, weight: d.weight,
        enabled: true, locked: !!d.locked, text: d.text,
        x: pos.x, y: pos.y, source: "seed", created_at: now,
      });
    });
  });
  return {
    version: 1,
    genome_key: "clarify_core",
    updated_at: now,
    nodes,
    edges: SEED_EDGES.map(e => ({ ...e })),
    mutations: [],
  };
}


// ─── persistence ─────────────────────────────────────────────────────────────
export function loadGenome() {
  const stored = sm.get(GENOME_KEY);
  if (stored && stored.version === 1 && validateGenome(stored).ok) return stored;
  return saveGenome(seedGenome()); // missing or corrupt → re-seed (never render a broken mind)
}

export function saveGenome(genome) {
  genome.updated_at = new Date().toISOString();
  sm.set(GENOME_KEY, genome);
  dnaBus.emit({ type: "genome", genome }); // every save announces itself — the view and canvas stay live
  return genome;
}

export function resetGenome() {
  return saveGenome(recordMutation(seedGenome(), "reset", "Genome reset to seed"));
}


// ─── mutation history ─────────────────────────────────────────────────────────
// Mutates the PASSED genome's `mutations` field (reassigns a fresh array, so a
// prior genome snapshot sharing the old array is never touched) and returns it.
// CRUD below always calls this on the freshly-copied genome, which is how the
// "pure-ish" contract holds: callers' original objects stay intact.
export function recordMutation(genome, kind, summary) {
  const entry = { id: newId("mut"), ts: new Date().toISOString(), kind, summary };
  genome.mutations = [entry, ...(genome.mutations || [])].slice(0, 200);
  return genome;
}


// ─── CRUD — take genome, return NEW genome; refusals return the SAME reference
//     so callers can cheaply detect a no-op (nextGenome === genome). ──────────
export function addNode(genome, { label, region, text, weight = 0.6, x = 0, y = 0, source = "user" }) {
  const reg = REGIONS[region] ? region : "knowledge"; // unknown region → knowledge, the least presumptuous home
  const base = `n_${slugify(label)}`;
  let id = base, n = 2;
  while (genome.nodes.some(nd => nd.id === id)) id = `${base}_${n++}`;
  const node = {
    id, label: String(label || "New node").slice(0, 28), region: reg, weight: clamp01(weight),
    enabled: true, locked: false, text: String(text || ""), x, y, source,
    created_at: new Date().toISOString(),
  };
  const next = recordMutation(
    { ...genome, nodes: [...genome.nodes, node] },
    "add_node", `Grew "${node.label}" in ${REGIONS[reg].label}${source === "learned" ? " (learned)" : ""}`
  );
  return { genome: next, node };
}

export function updateNode(genome, id, patch) {
  const node = genome.nodes.find(n => n.id === id);
  if (!node) return genome;
  const p = { ...patch };
  if (node.locked) { // governance armor: a locked node cannot be disabled or unlocked
    if (p.enabled === false) delete p.enabled;
    if (p.locked === false) delete p.locked;
  }
  if (p.weight !== undefined) p.weight = clamp01(p.weight);
  if (p.label !== undefined) p.label = String(p.label).slice(0, 28);
  if (Object.keys(p).length === 0) return genome;
  const next = { ...genome, nodes: genome.nodes.map(n => (n.id === id ? { ...n, ...p } : n)) };
  // Position-only patches are layout, not thought — the canvas writes x,y on
  // every drag end and that must not flood the mutation history.
  if (Object.keys(p).every(k => k === "x" || k === "y")) return next;
  let summary;
  if (p.weight !== undefined && p.weight !== node.weight) {
    summary = `${p.weight > node.weight ? "Strengthened" : "Weakened"} "${node.label}" ${node.weight.toFixed(2)} → ${p.weight.toFixed(2)}`;
  } else if (p.enabled === false && isAwake(node)) summary = `Silenced "${node.label}"`;
  else if (p.enabled === true && !isAwake(node)) summary = `Awakened "${node.label}"`;
  else summary = `Rewrote "${p.label || node.label}"`;
  return recordMutation(next, "update_node", summary);
}

export function removeNode(genome, id) {
  const node = genome.nodes.find(n => n.id === id);
  if (!node || node.locked) return genome; // locked = load-bearing; deletion refused
  const cut = genome.edges.filter(e => e.from === id || e.to === id).length;
  const next = {
    ...genome,
    nodes: genome.nodes.filter(n => n.id !== id),
    edges: genome.edges.filter(e => e.from !== id && e.to !== id), // cascade — no dangling synapses, ever
  };
  return recordMutation(next, "remove_node", `Removed "${node.label}"${cut ? ` and ${cut} synapse${cut !== 1 ? "s" : ""}` : ""}`);
}

const nodeLabel = (genome, id) => genome.nodes.find(n => n.id === id)?.label || id;

export function addEdge(genome, { from, to, weight = 0.6, polarity = 1 }) {
  if (!from || !to || from === to) return genome;                        // no self-loops
  if (!genome.nodes.some(n => n.id === from) || !genome.nodes.some(n => n.id === to)) return genome; // no dangling
  if (genome.edges.some(e => e.from === from && e.to === to)) return genome; // one synapse per direction pair
  const base = `e_${from.replace(/^n_/, "")}_${to.replace(/^n_/, "")}`;
  let id = base, n = 2;
  while (genome.edges.some(e => e.id === id)) id = `${base}_${n++}`;
  const pol = polarity === -1 ? -1 : 1;
  const edge = { id, from, to, weight: clamp01(weight), polarity: pol };
  return recordMutation(
    { ...genome, edges: [...genome.edges, edge] },
    "add_edge", `Wired "${nodeLabel(genome, from)}" ${pol === -1 ? "⊣" : "→"} "${nodeLabel(genome, to)}" at ${edge.weight.toFixed(2)}`
  );
}

export function updateEdge(genome, id, patch) {
  const edge = genome.edges.find(e => e.id === id);
  if (!edge) return genome;
  const p = { ...patch };
  delete p.from; delete p.to; // rewiring endpoints is remove+add, not a patch — keeps dupe/self-loop guards honest
  if (p.weight !== undefined) p.weight = clamp01(p.weight);
  if (p.polarity !== undefined) p.polarity = p.polarity === -1 ? -1 : 1;
  if (Object.keys(p).length === 0) return genome;
  const next = { ...genome, edges: genome.edges.map(e => (e.id === id ? { ...e, ...p } : e)) };
  const pair = `"${nodeLabel(genome, edge.from)}" → "${nodeLabel(genome, edge.to)}"`;
  const summary = p.polarity !== undefined && p.polarity !== edge.polarity
    ? `Flipped ${pair} to ${p.polarity === -1 ? "tempering" : "excitatory"}`
    : `Retuned ${pair} ${edge.weight.toFixed(2)} → ${(p.weight !== undefined ? p.weight : edge.weight).toFixed(2)}`;
  return recordMutation(next, "update_edge", summary);
}

export function removeEdge(genome, id) {
  const edge = genome.edges.find(e => e.id === id);
  if (!edge) return genome;
  return recordMutation(
    { ...genome, edges: genome.edges.filter(e => e.id !== id) },
    "remove_edge", `Cut synapse "${nodeLabel(genome, edge.from)}" → "${nodeLabel(genome, edge.to)}"`
  );
}


// ─── validation — guards imports and self-inflicted corruption ───────────────
export function validateGenome(g) {
  const errors = [];
  if (!g || typeof g !== "object") return { ok: false, errors: ["genome is not an object"] };
  if (!Array.isArray(g.nodes)) errors.push("nodes is not an array");
  if (!Array.isArray(g.edges)) errors.push("edges is not an array");
  if (errors.length) return { ok: false, errors };
  // Entry guards first — a null/scalar entry is INVALID, never a TypeError.
  // loadGenome's re-seed path and importJson's toast both rely on this
  // function returning {ok:false} for any garbage, not throwing on it.
  const ids = new Set();
  g.nodes.forEach(n => {
    if (!n || typeof n !== "object") { errors.push("node is not an object"); return; }
    if (!n.id || typeof n.id !== "string") errors.push("node with missing id");
    else if (ids.has(n.id)) errors.push(`duplicate node id ${n.id}`);
    else ids.add(n.id);
    if (!REGIONS[n.region]) errors.push(`node ${n.id}: unknown region "${n.region}"`);
    if (typeof n.weight !== "number" || !Number.isFinite(n.weight) || n.weight < 0 || n.weight > 1) errors.push(`node ${n.id}: weight out of 0..1`);
    if (typeof n.label !== "string" || !n.label) errors.push(`node ${n.id}: missing label`);
  });
  const eids = new Set();
  g.edges.forEach(e => {
    if (!e || typeof e !== "object") { errors.push("edge is not an object"); return; }
    if (!e.id || eids.has(e.id)) errors.push(`edge with missing or duplicate id ${e.id || "?"}`);
    else eids.add(e.id);
    if (!ids.has(e.from)) errors.push(`edge ${e.id}: dangling from "${e.from}"`);
    if (!ids.has(e.to)) errors.push(`edge ${e.id}: dangling to "${e.to}"`);
    if (typeof e.weight !== "number" || !Number.isFinite(e.weight) || e.weight < 0 || e.weight > 1) errors.push(`edge ${e.id}: weight out of 0..1`);
    if (e.polarity !== 1 && e.polarity !== -1) errors.push(`edge ${e.id}: polarity must be 1 or -1`);
  });
  return { ok: errors.length === 0, errors };
}


// ─── the compiler — the graph IS the prompt ──────────────────────────────────
// DETERMINISTIC: same genome ⇒ byte-identical string ⇒ same hash. Everything
// that could wobble is pinned — region order is REGION_ORDER, in-region order
// is weight desc then id asc, tension order is edge id asc. GOVERNANCE_RULES
// leads verbatim so no weight slider can ever out-rank the approval spine.
// Weight bands translate a slider into prompt emphasis: ≥0.75 commands
// (PRIMARY), ≥0.4 informs, <0.4 barely whispers. Disabled nodes don't exist.
// Inhibitory edges between enabled nodes become explicit conflict-resolution
// lines — the model is TOLD which impulse wins, not left to average them.
export function compileGenome(genome) {
  const byId = new Map(genome.nodes.map(n => [n.id, n]));
  const sections = [];
  for (const region of REGION_ORDER) {
    const lines = genome.nodes
      .filter(n => isAwake(n) && n.region === region)
      .sort((a, b) => (b.weight - a.weight) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(n => (n.weight >= 0.75 ? `PRIMARY — ${n.text}` : n.weight >= 0.4 ? n.text : `Minor consideration — ${n.text}`));
    if (lines.length) sections.push({ region, lines });
  }
  const tensions = genome.edges
    .filter(e => e.polarity === -1 && isAwake(byId.get(e.from)) && isAwake(byId.get(e.to)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(e => `TENSION: ${byId.get(e.from).label} tempers ${byId.get(e.to).label} — when they conflict, ${byId.get(e.from).label} wins.`);

  const parts = [GOVERNANCE_RULES];
  sections.forEach(s => {
    parts.push(`${REGIONS[s.region].label.toUpperCase()} — ${REGIONS[s.region].desc}:\n${s.lines.map(l => `- ${l}`).join("\n")}`);
  });
  if (tensions.length) {
    parts.push(`INTERNAL TENSIONS:\n${tensions.map(l => `- ${l}`).join("\n")}`);
    sections.push({ region: "tension", lines: tensions }); // pseudo-section so UIs can render the tension block too
  }
  const systemPrompt = parts.join("\n\n");
  return { systemPrompt, sections, hash: djb2(systemPrompt) };
}


// ─── activation spread — pure, for pulses and task traces ────────────────────
// Seeds light at 1.0 and the wave rolls outward along edge direction. Per step,
// every edge reads its source's level FROM THE PREVIOUS STEP (synchronous
// update, so within-step edge order can never change the result):
//   excitatory:  target = max(target, source·weight·decay)   — order-free (max)
//   inhibitory:  target = max(0, target − source·weight·decay) — dampens, clamps at 0
// Excitation applies before inhibition inside a step, so tempering always gets
// the last word — same rule the compiler states in its TENSION lines. Disabled
// nodes never activate and never relay. max() + multiplicative decay makes
// levels monotone-bounded, so the wave provably dies; we stop the moment a
// step changes nothing (tested), or at `steps`, whichever comes first.
export function propagate(genome, seedIds, { steps = 4, decay = 0.55 } = {}) {
  const EPS = 0.01; // below this a node is "dark" — keeps ripples finite and traces readable
  const enabled = new Set(genome.nodes.filter(n => isAwake(n)).map(n => n.id));
  const levels = {};
  genome.nodes.forEach(n => { levels[n.id] = 0; });
  const step0 = [];
  (seedIds || []).forEach(id => {
    if (enabled.has(id) && levels[id] !== 1) { levels[id] = 1; step0.push(id); }
  });
  const order = [step0];
  const edgesFired = [];
  const firedSet = new Set();

  for (let s = 0; s < steps; s++) {
    const prev = { ...levels };
    for (const e of genome.edges) { // excitation pass — reads prev, max() into levels
      if (e.polarity === -1 || !enabled.has(e.from) || !enabled.has(e.to)) continue;
      const src = prev[e.from];
      if (src <= EPS) continue;
      const push = src * e.weight * decay;
      if (push > levels[e.to]) {
        levels[e.to] = push;
        if (!firedSet.has(e.id)) { firedSet.add(e.id); edgesFired.push(e.id); }
      }
    }
    for (const e of genome.edges) { // inhibition pass — tempering gets the last word
      if (e.polarity !== -1 || !enabled.has(e.from) || !enabled.has(e.to)) continue;
      const src = prev[e.from];
      if (src <= EPS || levels[e.to] <= 0) continue;
      levels[e.to] = Math.max(0, levels[e.to] - src * e.weight * decay);
      if (!firedSet.has(e.id)) { firedSet.add(e.id); edgesFired.push(e.id); }
    }
    let changed = false;
    const newly = [];
    genome.nodes.forEach(n => {
      if (levels[n.id] !== prev[n.id]) changed = true;
      if (prev[n.id] <= EPS && levels[n.id] > EPS) newly.push(n.id);
    });
    if (newly.length) order.push(newly);
    if (!changed) break; // fixpoint — the wave died before the step budget did
  }
  return { levels, order, edgesFired };
}


// Task kind → seed ids for the activation trace. The mapped skill node leads,
// followed by its strongest ENABLED excitatory inputs (the signals/knowledge
// that argue FOR the act) so each task kind lights a distinct causal
// neighborhood — the tempering principles then fire via propagate itself.
const TASK_SKILL = {
  draft: "n_sk_draft", enrich: "n_sk_enrich", classify: "n_sk_classify",
  followup: "n_sk_followup", strategy: "n_sk_strategy", grow: "n_sk_grow",
};

export function seedsForTask(genome, kind) {
  const skillId = TASK_SKILL[kind];
  if (!skillId || !genome.nodes.some(n => n.id === skillId)) return [];
  const enabled = new Set(genome.nodes.filter(n => isAwake(n)).map(n => n.id));
  const inputs = genome.edges
    .filter(e => e.to === skillId && e.polarity === 1 && enabled.has(e.from))
    .sort((a, b) => (b.weight - a.weight) || (a.id < b.id ? -1 : 1))
    .slice(0, 4)
    .map(e => e.from);
  return [skillId, ...inputs];
}


// ─── event bus — module-level singleton ──────────────────────────────────────
// One channel, two event shapes:
//   {type:"activation", seeds, trace, label}  — worker/pulse fires the canvas
//   {type:"genome", genome}                   — every saveGenome, so all views converge
// Listeners are isolated: one throwing subscriber never silences the rest.
export const dnaBus = (() => {
  const subs = new Set();
  return {
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    emit(evt) { subs.forEach(fn => { try { fn(evt); } catch {} }); },
  };
})();


// ─── stats — the header pills read this ──────────────────────────────────────
export function genomeStats(genome) {
  const byRegion = {};
  Object.keys(REGIONS).forEach(r => { byRegion[r] = 0; });
  let enabled = 0;
  genome.nodes.forEach(n => {
    byRegion[n.region] = (byRegion[n.region] || 0) + 1;
    if (isAwake(n)) enabled++;
  });
  return { nodes: genome.nodes.length, edges: genome.edges.length, enabled, byRegion };
}
