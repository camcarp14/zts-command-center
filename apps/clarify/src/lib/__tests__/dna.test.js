import { beforeEach, describe, expect, it } from "vitest";
import {
  GENOME_KEY, REGIONS, REGION_ORDER,
  seedGenome, loadGenome, saveGenome, resetGenome,
  recordMutation, addNode, updateNode, removeNode,
  addEdge, updateEdge, removeEdge,
  validateGenome, compileGenome, propagate, seedsForTask,
  dnaBus, genomeStats,
} from "../dna.js";
import { GOVERNANCE_RULES } from "../prompts.js";
import { sm } from "../store.js";

// ── localStorage shim ─────────────────────────────────────────────────────────
// store.js swallows a missing localStorage (try/catch), which would make every
// loadGenome re-seed and every save a no-op — fine for the app, useless for
// testing persistence. A Map-backed stand-in makes sm real under node.
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
// Minimal genome builder: sane defaults, so each test states only what it's about.
const fix = (nodes, edges = []) => ({
  version: 1, genome_key: "test", updated_at: "",
  nodes: nodes.map(n => ({
    label: n.id, region: "signal", weight: 0.5, enabled: true, locked: false,
    text: `text of ${n.id}`, x: 0, y: 0, source: "seed", created_at: "", ...n,
  })),
  edges: edges.map(e => ({ id: `e_${e.from}_${e.to}`, weight: 1, polarity: 1, ...e })),
  mutations: [],
});

// ── seed genome ───────────────────────────────────────────────────────────────
describe("seedGenome", () => {
  it("validates clean", () => {
    const v = validateGenome(seedGenome());
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("carries six locked, enabled governance principles — approval spine included", () => {
    const g = seedGenome();
    const principles = g.nodes.filter(n => n.region === "principle");
    expect(principles).toHaveLength(6);
    principles.forEach(n => {
      expect(n.locked).toBe(true);
      expect(n.enabled).toBe(true);
      expect(n.source).toBe("seed");
    });
    const spine = g.nodes.find(n => n.id === "n_pr_approval");
    expect(spine).toBeTruthy();
    expect(spine.text).toMatch(/never send/i);
    expect(spine.text).toMatch(/approval queue/i);
  });

  it("matches the spec's region census (~30 nodes / ~55 edges)", () => {
    const g = seedGenome();
    const { byRegion } = genomeStats(g);
    expect(byRegion).toEqual({ identity: 4, principle: 6, knowledge: 6, signal: 6, skill: 6, goal: 4 });
    expect(g.nodes.length).toBeGreaterThanOrEqual(30);
    expect(g.edges.length).toBeGreaterThanOrEqual(55);
    expect(g.edges.some(e => e.polarity === -1)).toBe(true); // the mind has tensions
  });

  it("is deterministic — two seeds are structurally identical (jitter is hashed, not random)", () => {
    const shape = (g) => ({ nodes: g.nodes.map(({ created_at, ...n }) => n), edges: g.edges });
    expect(shape(seedGenome())).toEqual(shape(seedGenome()));
  });

  it("keeps labels canvas-sized and every weight in 0..1", () => {
    const g = seedGenome();
    g.nodes.forEach(n => {
      expect(n.label.length).toBeLessThanOrEqual(28);
      expect(n.weight).toBeGreaterThanOrEqual(0);
      expect(n.weight).toBeLessThanOrEqual(1);
    });
    g.edges.forEach(e => {
      expect(e.weight).toBeGreaterThanOrEqual(0);
      expect(e.weight).toBeLessThanOrEqual(1);
    });
  });

  it("seeds the hex arrangement — identity at center, other regions out on the ring", () => {
    const g = seedGenome();
    const dist = (n) => Math.hypot(n.x, n.y);
    g.nodes.forEach(n => {
      if (n.region === "identity") expect(dist(n)).toBeLessThan(150);
      else {
        expect(dist(n)).toBeGreaterThan(180);
        expect(dist(n)).toBeLessThan(470);
      }
    });
  });
});

// ── compileGenome ─────────────────────────────────────────────────────────────
describe("compileGenome", () => {
  it("is deterministic — two compiles of the same genome are byte-identical", () => {
    const g = seedGenome();
    const a = compileGenome(g);
    const b = compileGenome(g);
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(a.hash).toBe(b.hash);
    expect(a.sections).toEqual(b.sections);
  });

  it("opens with GOVERNANCE_RULES verbatim — no weight can out-rank the spine", () => {
    expect(compileGenome(seedGenome()).systemPrompt.startsWith(GOVERNANCE_RULES)).toBe(true);
  });

  it("orders regions identity → principle → goal → signal → knowledge → skill", () => {
    const { systemPrompt, sections } = compileGenome(seedGenome());
    const headers = REGION_ORDER.map(r => `\n${REGIONS[r].label.toUpperCase()} — `);
    const positions = headers.map(h => systemPrompt.indexOf(h));
    positions.forEach(p => expect(p).toBeGreaterThan(0));
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    expect(sections.filter(s => s.region !== "tension").map(s => s.region)).toEqual(REGION_ORDER);
  });

  it("sorts within a region by weight desc, then id asc", () => {
    const g = fix([
      { id: "z_low", weight: 0.5, text: "zed" },
      { id: "a_low", weight: 0.5, text: "ay" },
      { id: "m_top", weight: 0.9, text: "em" },
    ]);
    const sec = compileGenome(g).sections.find(s => s.region === "signal");
    expect(sec.lines).toEqual(["PRIMARY — em", "ay", "zed"]);
  });

  it("applies weight bands: PRIMARY ≥0.75, plain ≥0.4, minor <0.4", () => {
    const g = fix([
      { id: "hi", weight: 0.75, text: "command" },
      { id: "mid", weight: 0.4, text: "inform" },
      { id: "low", weight: 0.39, text: "whisper" },
    ]);
    const sec = compileGenome(g).sections.find(s => s.region === "signal");
    expect(sec.lines).toContain("PRIMARY — command");
    expect(sec.lines).toContain("inform");
    expect(sec.lines).toContain("Minor consideration — whisper");
  });

  it("omits disabled nodes entirely", () => {
    const g = fix([{ id: "on", text: "kept" }, { id: "off", enabled: false, text: "ghost directive" }]);
    expect(compileGenome(g).systemPrompt).not.toContain("ghost directive");
    expect(compileGenome(g).systemPrompt).toContain("kept");
  });

  it("treats a MISSING `enabled` field as awake — the whole stack's convention", () => {
    // Hand-authored/imported genomes (the future google_ads path) may omit
    // `enabled`; the worker, canvas, and inspector all read `!== false`, so the
    // compiler/propagator/stats must agree — or an imported mind renders fully
    // awake while compiling to GOVERNANCE_RULES alone.
    const g = fix([{ id: "a", text: "still compiles" }, { id: "b" }], [{ from: "a", to: "b", polarity: -1 }]);
    g.nodes.forEach(n => { delete n.enabled; });
    expect(compileGenome(g).systemPrompt).toContain("still compiles");
    expect(compileGenome(g).systemPrompt).toContain("INTERNAL TENSIONS:");
    expect(propagate(g, ["a"]).levels.a).toBe(1);
    expect(genomeStats(g).enabled).toBe(2);
  });

  it("compiles inhibitory edges between enabled nodes into the TENSION block — exact phrasing", () => {
    const g = fix(
      [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
      [{ from: "a", to: "b", polarity: -1 }]
    );
    const { systemPrompt } = compileGenome(g);
    expect(systemPrompt).toContain("INTERNAL TENSIONS:");
    expect(systemPrompt).toContain("TENSION: Alpha tempers Beta — when they conflict, Alpha wins.");
  });

  it("drops a tension when either endpoint is disabled", () => {
    const g = fix(
      [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta", enabled: false }],
      [{ from: "a", to: "b", polarity: -1 }]
    );
    expect(compileGenome(g).systemPrompt).not.toContain("INTERNAL TENSIONS");
  });

  it("hashes as hex and tracks content — a band-crossing weight change moves the hash", () => {
    const g = seedGenome();
    const before = compileGenome(g);
    expect(before.hash).toMatch(/^[0-9a-f]+$/);
    const g2 = updateNode(g, "n_kn_bids", { weight: 0.95 }); // 0.55 → 0.95 crosses into PRIMARY
    const after = compileGenome(g2);
    expect(after.hash).not.toBe(before.hash);
    expect(after.systemPrompt).not.toBe(before.systemPrompt);
  });
});

// ── propagate ─────────────────────────────────────────────────────────────────
describe("propagate", () => {
  it("seeds at 1.0 and decays multiplicatively across hops", () => {
    const g = fix(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [{ from: "a", to: "b", weight: 0.8 }, { from: "b", to: "c", weight: 1 }]
    );
    const { levels, order } = propagate(g, ["a"]);
    expect(levels.a).toBe(1);
    expect(levels.b).toBeCloseTo(0.44, 10);   // 1 · 0.8 · 0.55
    expect(levels.c).toBeCloseTo(0.242, 10);  // 0.44 · 1 · 0.55
    expect(order).toEqual([["a"], ["b"], ["c"]]);
  });

  it("never activates disabled nodes and never relays through them", () => {
    const g = fix(
      [{ id: "a" }, { id: "b", enabled: false }, { id: "c" }],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }]
    );
    const { levels, order } = propagate(g, ["a"]);
    expect(levels.b).toBe(0);
    expect(levels.c).toBe(0);
    expect(order).toEqual([["a"]]);
  });

  it("ignores disabled seeds", () => {
    const g = fix([{ id: "a", enabled: false }, { id: "b" }], [{ from: "a", to: "b" }]);
    const { levels } = propagate(g, ["a"]);
    expect(levels.a).toBe(0);
    expect(levels.b).toBe(0);
  });

  it("inhibition dampens after excitation and clamps at zero", () => {
    const g = fix(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [{ from: "a", to: "b", weight: 0.9 }, { id: "e_inhib", from: "c", to: "b", weight: 0.5, polarity: -1 }]
    );
    const { levels, edgesFired } = propagate(g, ["a", "c"]);
    expect(levels.b).toBeCloseTo(0.495 - 0.275, 10); // excite 0.9·0.55, then temper 0.5·0.55
    expect(edgesFired).toContain("e_inhib");
    // equal push and pull → exact cancellation, never negative
    const g2 = fix(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [{ from: "a", to: "b", weight: 1 }, { from: "c", to: "b", weight: 1, polarity: -1 }]
    );
    expect(propagate(g2, ["a", "c"]).levels.b).toBe(0);
  });

  it("terminates at the fixpoint even in a cycle with a generous step budget", () => {
    const g = fix(
      [{ id: "a" }, { id: "b" }],
      [{ from: "a", to: "b", weight: 1 }, { from: "b", to: "a", weight: 1 }]
    );
    const { levels, order } = propagate(g, ["a"], { steps: 50 });
    expect(levels.a).toBe(1);              // max() keeps the seed; the echo (0.3) can't raise it
    expect(levels.b).toBeCloseTo(0.55, 10);
    expect(order.length).toBeLessThanOrEqual(3); // wave dies immediately after the front passes
  });

  it("is pure — the genome is untouched and repeat calls agree", () => {
    const g = seedGenome();
    const snapshot = JSON.stringify(g);
    const a = propagate(g, ["n_sg_ads_live"]);
    const b = propagate(g, ["n_sg_ads_live"]);
    expect(JSON.stringify(g)).toBe(snapshot);
    expect(a).toEqual(b);
    expect(a.levels.n_sk_draft).toBeGreaterThan(0); // ads-live excites drafting…
    expect(a.levels.n_sk_draft).toBeLessThan(1);    // …but decay + tempering keep it sub-seed
  });
});

// ── seedsForTask ──────────────────────────────────────────────────────────────
describe("seedsForTask", () => {
  it("leads with the task's skill node, then its strongest excitatory inputs", () => {
    const seeds = seedsForTask(seedGenome(), "draft");
    expect(seeds[0]).toBe("n_sk_draft");
    expect(seeds).toContain("n_sg_ads_live");     // strongest input to drafting
    expect(seeds).not.toContain("n_pr_approval"); // inhibitory feeds fire via propagate, not as seeds
    expect(seeds.length).toBeLessThanOrEqual(5);
  });

  it("skips disabled inputs and returns [] for unknown kinds", () => {
    let g = seedGenome();
    g = { ...g, nodes: g.nodes.map(n => (n.id === "n_sg_ads_live" ? { ...n, enabled: false } : n)) };
    expect(seedsForTask(g, "draft")).not.toContain("n_sg_ads_live");
    expect(seedsForTask(seedGenome(), "nonsense")).toEqual([]);
  });
});

// ── CRUD + mutation history ───────────────────────────────────────────────────
describe("CRUD", () => {
  it("addNode returns {genome, node}, leaves the original untouched, records history", () => {
    const g = seedGenome();
    const before = g.nodes.length;
    const { genome: g2, node } = addNode(g, { label: "Test insight", region: "knowledge", text: "T", x: 5, y: 6 });
    expect(node.id).toMatch(/^n_test_insight/);
    expect(node.source).toBe("user");
    expect(g2.nodes).toHaveLength(before + 1);
    expect(g.nodes).toHaveLength(before);          // purity of the original
    expect(g2.mutations[0].kind).toBe("add_node");
    expect(g2.mutations[0].summary).toContain('"Test insight"');
    expect(g.mutations).toHaveLength(0);           // history landed only on the copy
  });

  it("addNode de-collides slug ids", () => {
    const g = seedGenome();
    const { genome: g2, node: n1 } = addNode(g, { label: "Same Name", region: "signal", text: "1" });
    const { node: n2 } = addNode(g2, { label: "Same Name", region: "signal", text: "2" });
    expect(n1.id).not.toBe(n2.id);
  });

  it("updateNode narrates weight changes in the mutation history", () => {
    const g = seedGenome();
    const g2 = updateNode(g, "n_kn_bids", { weight: 0.9 });
    expect(g2.mutations[0].summary).toBe('Strengthened "Bid-strategy ladder" 0.55 → 0.90');
    const g3 = updateNode(g2, "n_kn_bids", { weight: 0.2 });
    expect(g3.mutations[0].summary).toBe('Weakened "Bid-strategy ladder" 0.90 → 0.20');
  });

  it("updateNode refuses to disable or unlock a locked node — weight stays adjustable", () => {
    const g = seedGenome();
    expect(updateNode(g, "n_pr_approval", { enabled: false })).toBe(g); // fully stripped → no-op, same ref
    const g2 = updateNode(g, "n_pr_approval", { enabled: false, weight: 0.8 });
    const spine = g2.nodes.find(n => n.id === "n_pr_approval");
    expect(spine.enabled).toBe(true);
    expect(spine.locked).toBe(true);
    expect(spine.weight).toBe(0.8);
  });

  it("updateNode treats position-only patches as layout, not history", () => {
    const g = seedGenome();
    const g2 = updateNode(g, "n_sg_ads_live", { x: 42, y: -17 });
    const moved = g2.nodes.find(n => n.id === "n_sg_ads_live");
    expect([moved.x, moved.y]).toEqual([42, -17]);
    expect(g2.mutations).toHaveLength(0);
  });

  it("removeNode refuses locked nodes (same reference back)", () => {
    const g = seedGenome();
    expect(removeNode(g, "n_pr_approval")).toBe(g);
  });

  it("removeNode cascades every touching edge — no dangling synapses", () => {
    const g = seedGenome();
    const touching = g.edges.filter(e => e.from === "n_sg_ads_live" || e.to === "n_sg_ads_live").length;
    expect(touching).toBeGreaterThan(0);
    const g2 = removeNode(g, "n_sg_ads_live");
    expect(g2.nodes.some(n => n.id === "n_sg_ads_live")).toBe(false);
    expect(g2.edges.some(e => e.from === "n_sg_ads_live" || e.to === "n_sg_ads_live")).toBe(false);
    expect(validateGenome(g2).ok).toBe(true);
    expect(g2.mutations[0].summary).toMatch(/Removed "Ads-live priority" and \d+ synapses/);
  });

  it("addEdge refuses self-loops, duplicate pairs, and unknown endpoints", () => {
    const g = seedGenome();
    expect(addEdge(g, { from: "n_sk_draft", to: "n_sk_draft" })).toBe(g);
    expect(addEdge(g, { from: "n_sg_ads_live", to: "n_sk_draft" })).toBe(g); // seed already wires this pair
    expect(addEdge(g, { from: "n_ghost", to: "n_sk_draft" })).toBe(g);
  });

  it("addEdge wires with defaults and narrates polarity", () => {
    const g = seedGenome();
    const g2 = addEdge(g, { from: "n_kn_match", to: "n_sk_draft" });
    const edge = g2.edges.find(e => e.from === "n_kn_match" && e.to === "n_sk_draft");
    expect(edge).toBeTruthy();
    expect(edge.weight).toBe(0.6);
    expect(edge.polarity).toBe(1);
    expect(edge.id).toMatch(/^e_/);
    const g3 = addEdge(g, { from: "n_pr_cite", to: "n_sk_draft", polarity: -1 });
    expect(g3.mutations[0].summary).toContain("⊣");
  });

  it("updateEdge retunes weight, flips polarity, and ignores endpoint rewires", () => {
    const g = seedGenome();
    const id = g.edges.find(e => e.from === "n_sg_ads_live" && e.to === "n_sk_draft").id;
    const g2 = updateEdge(g, id, { weight: 0.3 });
    expect(g2.edges.find(e => e.id === id).weight).toBe(0.3);
    expect(g2.mutations[0].summary).toMatch(/Retuned .* 0\.90 → 0\.30/);
    const g3 = updateEdge(g, id, { polarity: -1 });
    expect(g3.edges.find(e => e.id === id).polarity).toBe(-1);
    expect(g3.mutations[0].summary).toMatch(/Flipped .* to tempering/);
    const g4 = updateEdge(g, id, { from: "n_gl_brand" });
    expect(g4).toBe(g); // endpoints are stripped → nothing to patch
  });

  it("removeEdge cuts exactly one synapse", () => {
    const g = seedGenome();
    const id = g.edges[0].id;
    const g2 = removeEdge(g, id);
    expect(g2.edges).toHaveLength(g.edges.length - 1);
    expect(g2.edges.some(e => e.id === id)).toBe(false);
    expect(removeEdge(g, "e_nonexistent")).toBe(g);
  });

  it("caps mutation history at 200, newest first", () => {
    let g = seedGenome();
    for (let i = 0; i < 210; i++) g = updateNode(g, "n_kn_bids", { weight: i % 2 ? 0.9 : 0.2 });
    expect(g.mutations).toHaveLength(200);
    expect(g.mutations[0].summary).toMatch(/"Bid-strategy ladder"/);
    expect(new Date(g.mutations[0].ts).getTime()).toBeGreaterThanOrEqual(new Date(g.mutations[199].ts).getTime());
  });

  it("recordMutation stamps id/ts and never touches a prior snapshot's array", () => {
    const g = seedGenome();
    const prevArr = g.mutations;
    const g2 = recordMutation({ ...g }, "test", "hello");
    expect(g2.mutations[0]).toMatchObject({ kind: "test", summary: "hello" });
    expect(g2.mutations[0].id).toBeTruthy();
    expect(prevArr).toHaveLength(0);
  });
});

// ── validateGenome ────────────────────────────────────────────────────────────
describe("validateGenome", () => {
  it("rejects non-objects and missing arrays", () => {
    expect(validateGenome(null).ok).toBe(false);
    expect(validateGenome({ nodes: "x", edges: [] }).ok).toBe(false);
  });

  it("catches dangling edges", () => {
    const g = fix([{ id: "a" }], [{ from: "a", to: "ghost" }]);
    const v = validateGenome(g);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/dangling to "ghost"/);
  });

  it("catches bad regions, out-of-range weights, and bad polarity", () => {
    const g = fix(
      [{ id: "a", region: "vibes" }, { id: "b", weight: 1.4 }],
      [{ from: "a", to: "b", polarity: 0 }]
    );
    const errs = validateGenome(g).errors.join(" ");
    expect(errs).toMatch(/unknown region "vibes"/);
    expect(errs).toMatch(/node b: weight out of 0\.\.1/);
    expect(errs).toMatch(/polarity must be 1 or -1/);
  });

  it("catches duplicate node ids", () => {
    const g = fix([{ id: "a" }, { id: "a" }]);
    expect(validateGenome(g).errors.join(" ")).toMatch(/duplicate node id a/);
  });

  it("returns {ok:false} for null/scalar entries — never throws", () => {
    // Valid JSON, garbage content: this exact payload used to TypeError inside
    // validateGenome, turning loadGenome's re-seed guard into a render crash.
    const nullNode = { version: 1, nodes: [null], edges: [] };
    expect(validateGenome(nullNode).ok).toBe(false);
    expect(validateGenome(nullNode).errors.join(" ")).toMatch(/node is not an object/);
    expect(validateGenome({ version: 1, nodes: [], edges: [null] }).ok).toBe(false);
    expect(validateGenome({ version: 1, nodes: [42], edges: ["x"] }).ok).toBe(false);
  });
});

// ── persistence + bus ─────────────────────────────────────────────────────────
describe("persistence & dnaBus", () => {
  it("loadGenome auto-seeds and persists when storage is empty", () => {
    expect(sm.get(GENOME_KEY)).toBeNull();
    const g = loadGenome();
    expect(validateGenome(g).ok).toBe(true);
    expect(sm.get(GENOME_KEY).genome_key).toBe("clarify_core");
  });

  it("loadGenome returns the stored genome when valid, re-seeds when corrupt", () => {
    const g = loadGenome();
    saveGenome(updateNode(g, "n_kn_bids", { weight: 0.91 }));
    expect(loadGenome().nodes.find(n => n.id === "n_kn_bids").weight).toBe(0.91);
    sm.set(GENOME_KEY, { version: 1, nodes: "corrupt", edges: [] });
    expect(validateGenome(loadGenome()).ok).toBe(true);
    expect(loadGenome().nodes.length).toBeGreaterThanOrEqual(30);
    sm.set(GENOME_KEY, { version: 1, nodes: [null], edges: [] }); // null entry — must re-seed, not throw
    expect(validateGenome(loadGenome()).ok).toBe(true);
  });

  it("saveGenome stamps updated_at and announces on the bus; unsub stops delivery", () => {
    const seen = [];
    const off = dnaBus.on(evt => seen.push(evt));
    const g = seedGenome();
    g.updated_at = "";
    saveGenome(g);
    expect(g.updated_at).not.toBe("");
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("genome");
    expect(seen[0].genome).toBe(g);
    off();
    saveGenome(g);
    expect(seen).toHaveLength(1);
  });

  it("a throwing subscriber never silences the others", () => {
    const seen = [];
    const off1 = dnaBus.on(() => { throw new Error("bad listener"); });
    const off2 = dnaBus.on(evt => seen.push(evt));
    dnaBus.emit({ type: "activation", seeds: [], trace: null, label: "test" });
    expect(seen).toHaveLength(1);
    off1(); off2();
  });

  it("resetGenome re-seeds, persists, and records the reset", () => {
    saveGenome(removeNode(loadGenome(), "n_sg_ads_live"));
    const g = resetGenome();
    expect(g.nodes.some(n => n.id === "n_sg_ads_live")).toBe(true);
    expect(g.mutations[0].kind).toBe("reset");
    expect(sm.get(GENOME_KEY).nodes.length).toBe(g.nodes.length);
  });
});

// ── genomeStats ───────────────────────────────────────────────────────────────
describe("genomeStats", () => {
  it("counts nodes, edges, enabled, and the region census", () => {
    const g = seedGenome();
    const s = genomeStats(g);
    expect(s.nodes).toBe(g.nodes.length);
    expect(s.edges).toBe(g.edges.length);
    expect(s.enabled).toBe(g.nodes.length); // seed ships fully awake
    const g2 = updateNode(g, "n_kn_bids", { enabled: false });
    expect(genomeStats(g2).enabled).toBe(g.nodes.length - 1);
    expect(genomeStats(g2).byRegion.knowledge).toBe(6); // disabled still counted — it exists, it's just silent
  });
});
