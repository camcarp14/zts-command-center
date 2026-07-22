// Pure-core tests for the DNA layer — runs on plain `node --test`, no deps.
// Covers the invariants the whole tab leans on: the compiler is deterministic,
// validation rejects corrupt genomes, propagation dies out and respects
// disabled nodes, and the worker's pure helpers (inShift, proposeTasks) gate
// correctly. localStorage is stubbed before import because dna.js's persistence
// helpers reference it (the pure functions under test never touch it).

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  key(i) { return [...this._m.keys()][i] ?? null; },
  get length() { return this._m.size; },
};
globalThis.window = undefined;

const { seedGenome, compileGenome, validateGenome, propagate, seedsForTask, isAwake, genomeStats, ZTS_GOVERNANCE } =
  await import("../src/dna/dna.js");
const { inShift, proposeTasks, WORKER_DEFAULTS } = await import("../src/dna/dnaWorker.js");

test("seed genome validates clean", () => {
  const g = seedGenome();
  const v = validateGenome(g);
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.ok(g.nodes.length > 20);
  assert.ok(g.edges.length > 30);
});

test("compileGenome is deterministic — same genome, byte-identical prompt and hash", () => {
  const g = seedGenome();
  const a = compileGenome(g);
  const b = compileGenome(structuredClone(g));
  assert.equal(a.systemPrompt, b.systemPrompt);
  assert.equal(a.hash, b.hash);
  assert.ok(a.systemPrompt.startsWith(ZTS_GOVERNANCE), "governance charter must lead the prompt");
});

test("disabled nodes are omitted from the compiled mind", () => {
  const g = seedGenome();
  const target = g.nodes.find(n => !n.locked && n.weight >= 0.75);
  const before = compileGenome(g);
  assert.ok(before.systemPrompt.includes(target.text));
  target.enabled = false;
  const after = compileGenome(g);
  assert.ok(!after.systemPrompt.includes(target.text));
  assert.notEqual(before.hash, after.hash);
});

test("validateGenome rejects corruption", () => {
  assert.equal(validateGenome(null).ok, false);
  assert.equal(validateGenome({ nodes: "nope", edges: [] }).ok, false);
  const g = seedGenome();
  const dup = structuredClone(g);
  dup.nodes.push({ ...dup.nodes[0] });
  assert.equal(validateGenome(dup).ok, false, "duplicate node id must be rejected");
  const dangling = structuredClone(g);
  dangling.edges.push({ id: "e_x", from: "n_missing", to: g.nodes[0].id, weight: 0.5, polarity: 1 });
  assert.equal(validateGenome(dangling).ok, false, "dangling edge must be rejected");
});

test("propagate: seeds light at 1.0, wave stays bounded, disabled nodes stay dark", () => {
  const g = seedGenome();
  const seeds = seedsForTask(g, "article");
  assert.ok(seeds.length > 0);
  const { levels } = propagate(g, seeds);
  for (const id of seeds) assert.equal(levels[id], 1);
  for (const v of Object.values(levels)) assert.ok(v >= 0 && v <= 1);
  const g2 = structuredClone(g);
  const off = g2.nodes.find(n => !n.locked && !seeds.includes(n.id));
  off.enabled = false;
  const r2 = propagate(g2, seeds);
  assert.equal(r2.levels[off.id], 0, "a silenced node must never activate");
  assert.equal(isAwake(off), false);
});

test("genomeStats counts enabled nodes and regions", () => {
  const g = seedGenome();
  const s = genomeStats(g);
  assert.equal(s.nodes, g.nodes.length);
  assert.equal(s.enabled, g.nodes.length); // seed ships fully awake
  assert.equal(Object.values(s.byRegion).reduce((a, b) => a + b, 0), g.nodes.length);
});

test("inShift: inclusive start, exclusive end, wraps midnight, fails closed", () => {
  const at = (h, m) => new Date(2026, 0, 1, h, m);
  const shift = { start: "18:00", end: "23:00" };
  assert.equal(inShift(shift, at(18, 0)), true);
  assert.equal(inShift(shift, at(22, 59)), true);
  assert.equal(inShift(shift, at(23, 0)), false);
  assert.equal(inShift(shift, at(12, 0)), false);
  const wrap = { start: "22:00", end: "02:00" };
  assert.equal(inShift(wrap, at(23, 30)), true);
  assert.equal(inShift(wrap, at(1, 59)), true);
  assert.equal(inShift(wrap, at(12, 0)), false);
  assert.equal(inShift({ start: "10:00", end: "10:00" }, at(10, 0)), false, "zero-length window is never in shift");
  assert.equal(inShift({ start: "banana", end: "23:00" }, at(20, 0)), false, "malformed times fail closed");
});

test("proposeTasks: skill toggles, awake gates, and today-dedup all hold", () => {
  const g = seedGenome();
  const creators = [{ id: "c1", channel_name: "BTC Sessions", status: "prospected", subscriber_count: 50000, niche: "self-custody" }];
  const now = new Date(2026, 0, 5, 12, 0);

  const tasks = proposeTasks(creators, [], [], g, [], {
    taskTypes: { ...WORKER_DEFAULTS.taskTypes, article: true },
    now, seoKeywords: "metal seed phrase backup",
  });
  assert.ok(tasks.some(t => t.kind === "scout"), "scout should propose with prospected creators");
  assert.ok(tasks.some(t => t.kind === "article" && t.keyword === "metal seed phrase backup"));

  // Today-dedup: a scout already attempted today is not re-proposed.
  const log = [{ kind: "scout", dedupKey: "scout_daily", ts: new Date(2026, 0, 5, 9, 0).toISOString(), status: "failed" }];
  const tasks2 = proposeTasks(creators, [], [], g, log, { taskTypes: WORKER_DEFAULTS.taskTypes, now });
  assert.ok(!tasks2.some(t => t.kind === "scout"), "today-dedup must gate a failed attempt to one shot per day");

  // Silencing the skill node in the genome switches the kind off entirely.
  const g2 = structuredClone(g);
  g2.nodes.find(n => n.id === "n_sk_scout").enabled = false;
  const tasks3 = proposeTasks(creators, [], [], g2, [], { taskTypes: WORKER_DEFAULTS.taskTypes, now });
  assert.ok(!tasks3.some(t => t.kind === "scout"), "a silenced skill node must stop its task kind");

  // Covered keywords are skipped.
  const tasks4 = proposeTasks(creators, [], [{ target_keyword: "metal seed phrase backup" }], g, [], {
    taskTypes: WORKER_DEFAULTS.taskTypes, now, seoKeywords: "metal seed phrase backup",
  });
  assert.ok(!tasks4.some(t => t.kind === "article"), "an already-covered keyword must not re-draft");
});
