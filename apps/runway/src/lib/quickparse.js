// Deterministic, zero-AI extraction used by board scans. Scans may touch
// hundreds of postings, so no per-posting model calls — cost and rate control.
// Any imported job can be enriched later with "Re-extract with AI".
// Pure functions, exercised by the planted-problems smoke test.

// Pull an annual USD comp range out of free text. Handles "$120,000-$140,000",
// "$130k–$150k", and hourly rates ("$55/hr" → ×2080). Ignores 401(k) and
// sub-$30k noise (fees, bonuses).
export function extractCompRange(text) {
  const t = String(text || '').replace(/401\s*\(?k\)?/gi, ' '); // retirement plan, not a salary
  const re = /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(k\b)?/gi;
  const vals = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    let v = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v) || v <= 0) continue;
    if (m[2]) v *= 1000;
    const after = t.slice(re.lastIndex, re.lastIndex + 24).toLowerCase();
    if (v < 250 && /(per\s*hour|\/\s*(hr|hour)|hourly)/.test(after)) v *= 2080;
    if (v >= 30000 && v <= 900000) vals.push(Math.round(v));
  }
  if (!vals.length) return { comp_min: null, comp_max: null };
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  // an absurdly wide span (e.g. $50k–$500k) means we grabbed unrelated figures
  // from the copy, not a real band — better to show no comp than a misleading one
  if (hi >= lo * 6) return { comp_min: null, comp_max: null };
  return { comp_min: lo, comp_max: hi };
}

export function detectRemote(text) {
  const t = String(text || '').toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\bremote\b|work from home|work-from-home/.test(t)) return 'remote';
  if (/on[- ]?site|in[- ]office|in person\b/.test(t)) return 'onsite';
  return 'unknown';
}

// title-token seniority, most-specific first ("Senior Manager" is a manager role)
export function detectSeniority(title) {
  const t = ` ${String(title || '').toLowerCase()} `;
  if (/\bintern(ship)?\b/.test(t)) return 'intern';
  if (/\bvp\b|vice president/.test(t)) return 'vp';
  if (/\bdirector\b|head of\b/.test(t)) return 'director';
  if (/\bmanager\b/.test(t)) return 'manager';
  if (/\blead\b|\bprincipal\b|\bstaff\b/.test(t)) return 'lead';
  if (/\bsenior\b|\bsr\.?\s/.test(t)) return 'senior';
  if (/\bjunior\b|\bjr\.?\s|\bassociate\b|\bcoordinator\b/.test(t)) return 'junior';
  return 'unknown';
}
