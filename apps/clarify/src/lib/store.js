// ─── Session Memory — cross-tab intelligence layer ───────────────────────────
// Reads/writes to localStorage with sm_ namespace. Zero API cost.
// Every component reads only the keys it needs (progressive disclosure).
export const sm = {
  set: (key, val) => { try { localStorage.setItem(`sm_${key}`, JSON.stringify(val)); } catch {} },
  get: (key) => { try { const v = localStorage.getItem(`sm_${key}`); return v ? JSON.parse(v) : null; } catch { return null; } },
  del: (key) => { try { localStorage.removeItem(`sm_${key}`); } catch {} },
  keys: (prefix = '') => { try { return Object.keys(localStorage).filter(k => k.startsWith(`sm_${prefix}`)).map(k => k.replace(/^sm_/, "").replace(new RegExp(`^${prefix}`), "")); } catch { return []; } },
};


// ─── Memory History — feeds prior context INTO reasoning, not just storage ───
// This is the fix for the gap where saved analyses existed but were never read
// back into the next analysis. Keeps the last 5 sessions per client.
export const memoryHistory = {
  push: (clientSlug, entry) => {
    const key = `history_${clientSlug}`;
    const existing = sm.get(key) || [];
    sm.set(key, [...existing, entry].slice(-5));
  },
  get: (clientSlug) => sm.get(`history_${clientSlug}`) || [],
};


// ─── store — one persistence door for app state ──────────────────────────────
// Wraps sm (the structured layer) and transparently migrates the older raw
// clarify_* localStorage keys the first time they're read. Writes mirror to the
// legacy key too, so reverting to a previous App.jsx never loses data.
// (The auth token stays raw on purpose — it's read before React state exists.)
export const store = {
  get(key, fallback) {
    const v = sm.get(key);
    if (v !== null) return v;
    try {
      const legacy = localStorage.getItem(`clarify_${key}`);
      if (legacy !== null) { const parsed = JSON.parse(legacy); sm.set(key, parsed); return parsed; }
    } catch {}
    return fallback;
  },
  set(key, val) {
    sm.set(key, val);
    try { localStorage.setItem(`clarify_${key}`, JSON.stringify(val)); } catch {}
  },
};


export const obs = {
  log: (entry) => {
    try {
      const existing = JSON.parse(localStorage.getItem("sm_obs_log") || "[]");
      const record = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ts: new Date().toISOString(), ...entry };
      localStorage.setItem("sm_obs_log", JSON.stringify([...existing, record].slice(-300)));
    } catch {}
  },
  getAll: () => { try { return JSON.parse(localStorage.getItem("sm_obs_log") || "[]"); } catch { return []; } },
  clear: () => { try { localStorage.removeItem("sm_obs_log"); } catch {} },
};
