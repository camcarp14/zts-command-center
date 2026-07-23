// Fuzzy role-title matching + repost (ghost-job) detection. Ported from
// santifer/career-ops role-matcher.mjs / detect-reposts.mjs, where the
// thresholds were tuned against real data-loss incidents: every relaxation of
// these rules upstream deleted live sibling-role applications. Pure functions,
// no I/O — exercised by the planted-problems smoke test, shared by the scan
// engine (server) and the UI (client).

export const SENIORITY_TOKENS = new Set([
  'junior', 'mid', 'middle', 'senior', 'staff', 'principal', 'lead', 'head',
  'chief', 'associate', 'intern', 'entry',
]);

// Tokens that almost every role shares must not count as strong matching
// signal: seniority, work mode, contract shape, common locations, meta noise.
export const ROLE_STOPWORDS = new Set([
  'junior', 'mid', 'middle', 'senior', 'staff', 'principal', 'lead', 'head',
  'chief', 'associate', 'intern', 'entry', 'level',
  'remote', 'hybrid', 'onsite', 'contract', 'contractor', 'freelance',
  'fulltime', 'parttime', 'permanent', 'temporary', 'internship',
  'role', 'position', 'opportunity', 'team', 'based',
  'repost', 'reposted', 'relisted',
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai',
  'london', 'berlin', 'paris', 'madrid', 'barcelona', 'amsterdam', 'dublin',
  'york', 'francisco', 'seattle', 'boston', 'austin', 'chicago', 'toronto',
  'tokyo', 'singapore', 'sydney', 'melbourne', 'lisbon', 'warsaw',
  'europe', 'emea', 'apac', 'latam', 'americas', 'india', 'spain', 'germany',
  'france', 'italy', 'canada', 'brazil', 'mexico', 'japan',
  'with', 'from', 'into', 'over', 'this', 'that',
]);

// Short specialty acronyms that are discriminating despite their length.
// Broad buckets like AI/ML are intentionally excluded — they appear across
// many unrelated roles.
export const SHORT_SPECIALTY = new Set([
  'api', 'sre', 'sdk', 'cli', 'gpu', 'cpu',
  'ios', 'qa', 'ux', 'ui', 'ar', 'vr',
  'ocr', 'crm', 'erp', 'sem', 'seo', 'ppc', 'cro',
]);

// Generic role-altitude descriptors: an overlap made ONLY of these is two
// titles written at the same altitude, not the same opening.
export const BASELINE_TOKENS = new Set([
  'software', 'engineer', 'developer', 'manager', 'architect',
  'analyst', 'designer', 'consultant', 'specialist',
  'platform', 'systems', 'services',
  'backend', 'frontend', 'full', 'stack', 'fullstack',
  'marketing', 'growth',
]);

export function roleTokens(role) {
  const text = typeof role === 'string' ? role : String(role ?? '');
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => (w.length > 3 || SHORT_SPECIALTY.has(w)) && !ROLE_STOPWORDS.has(w));
}

function extractSeniorities(title) {
  const text = typeof title === 'string' ? title : String(title ?? '');
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => SENIORITY_TOKENS.has(w)),
  );
}

// Are two titles likely the same opening? Requires: compatible seniority when
// both state one, >=2 shared tokens, >=1 non-baseline shared token, no
// strict-subset specialization ("X" vs "X, People Analytics" stay distinct),
// and set-Jaccard >= 0.6.
export function roleFuzzyMatch(a, b) {
  const senA = extractSeniorities(a);
  const senB = extractSeniorities(b);
  if (senA.size > 0 && senB.size > 0 && ![...senA].some((s) => senB.has(s))) return false;

  const wordsA = [...new Set(roleTokens(a))];
  const wordsB = [...new Set(roleTokens(b))];
  if (wordsA.length === 0 || wordsB.length === 0) return false;

  const setB = new Set(wordsB);
  const overlap = wordsA.filter((w) => setB.has(w));
  if (overlap.length < 2) return false;
  if (!overlap.some((w) => !BASELINE_TOKENS.has(w))) return false;

  // strict-subset guard: the superset's extra non-baseline word is exactly the
  // signal that these are two separately-postable openings
  const smaller = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const larger = wordsA.length <= wordsB.length ? wordsB : wordsA;
  if (larger.length > smaller.length && overlap.length === smaller.length) {
    const smallerSet = new Set(smaller);
    if (larger.some((w) => !smallerSet.has(w) && !BASELINE_TOKENS.has(w))) return false;
  }

  // true set-based Jaccard — dividing by the smaller set inflates matches for
  // titles sharing a long generic prefix
  const union = new Set([...wordsA, ...wordsB]).size;
  return overlap.length / union >= 0.6;
}

export const REPOST_WINDOW_DAYS = 90;

// Repost check at scan time: has this board listed the same role under a
// DIFFERENT posting id inside the window? Same external_id reappearing is a
// dedup hit, never a repost (career-ops semantics). priorRows are the board's
// seen_postings loaded before the scan, so batch-mates (one posting per
// location, first seen together) never flag each other.
export function detectRepost(candidate, priorRows, now = new Date(), windowDays = REPOST_WINDOW_DAYS) {
  const cutoff = now.getTime() - windowDays * 86400000;
  const title = String(candidate.title || '').trim();
  if (!title) return { reposted: false, priorListings: 0 };
  const tLower = title.toLowerCase().replace(/\s+/g, ' ');
  const ids = new Set();
  for (const r of priorRows || []) {
    if (!r || r.external_id === candidate.external_id) continue;
    const seen = r.first_seen_at ? new Date(r.first_seen_at).getTime() : NaN;
    if (!Number.isFinite(seen) || seen < cutoff) continue;
    const rTitle = String(r.title || '').trim();
    if (!rTitle) continue;
    const exact = rTitle.toLowerCase().replace(/\s+/g, ' ') === tLower;
    if (exact || roleFuzzyMatch(title, rTitle)) ids.add(r.external_id);
  }
  return { reposted: ids.size > 0, priorListings: ids.size };
}
