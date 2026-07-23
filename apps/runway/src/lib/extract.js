// Normalizes the AI extraction into the exact job shape the deterministic
// scoring engine consumes. Pure + shared with the smoke test: malformed model
// output must degrade to safe values, never crash a capture.
import { SENIORITY_LADDER, FLAG_DEFS } from './score.js';

const REMOTE_SET = new Set(['remote', 'hybrid', 'onsite', 'unknown']);
const SENIORITY_SET = new Set([...SENIORITY_LADDER, 'unknown']);
const KNOWN_FLAGS = new Set(Object.keys(FLAG_DEFS));

const str = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);

const money = (x) => {
  const n = typeof x === 'string' ? Number(x.replace(/[^0-9.]/g, '')) : Number(x);
  if (!Number.isFinite(n) || n <= 0) return null;
  // an "annual comp" under 1000 is almost certainly an hourly rate
  const annual = n < 1000 ? n * 2080 : n;
  return Math.round(annual);
};

export function normalizeExtraction(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let compMin = money(r.comp_min);
  let compMax = money(r.comp_max);
  if (compMin != null && compMax != null && compMin > compMax) [compMin, compMax] = [compMax, compMin];

  const remote = String(r.remote_type || '').toLowerCase();
  const seniority = String(r.seniority || '').toLowerCase();

  return {
    company: str(r.company) || '',
    title: str(r.title) || '',
    comp_min: compMin,
    comp_max: compMax,
    location: str(r.location),
    remote_type: REMOTE_SET.has(remote) ? remote : 'unknown',
    seniority: SENIORITY_SET.has(seniority) ? seniority : 'unknown',
    industry: str(r.industry),
    requirements: (Array.isArray(r.requirements) ? r.requirements : [])
      .map(str).filter(Boolean).slice(0, 10),
    flags: (Array.isArray(r.flags) ? r.flags : [])
      .map((f) => String(f)).filter((f) => KNOWN_FLAGS.has(f)),
    notes: (Array.isArray(r.read_between_lines) ? r.read_between_lines : [])
      .map(str).filter(Boolean).slice(0, 3),
  };
}
