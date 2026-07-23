// Requirements coverage — deterministic hit/miss of each posting requirement
// against the master resume. No AI: same inputs, same answer, every time,
// with planted-problem smoke tests. Feeds the job page panel and interview
// prep ("gaps and how to handle them").
import { hasKeyword } from './score.js';

// filler that appears in every requirements list and carries no signal
const STOP = new Set([
  'and', 'or', 'the', 'with', 'of', 'in', 'to', 'for', 'a', 'an', 'as', 'at', 'on',
  'years', 'year', 'yrs', 'experience', 'experienced', 'ability', 'able', 'strong',
  'proven', 'plus', 'preferred', 'required', 'work', 'working', 'knowledge',
  'skills', 'skill', 'including', 'etc', 'excellent', 'demonstrated', 'background',
  'familiarity', 'familiar', 'understanding', 'track', 'record', 'history',
  'minimum', 'least', 'using', 'use', 'managing', 'management', 'manage',
  'related', 'relevant', 'field', 'role', 'roles', 'you', 'your', 'have', 'has',
]);

const tokensOf = (req) =>
  String(req || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));

export function resumeText(content) {
  const c = content || {};
  const roles = Array.isArray(c.experience) ? c.experience : [];
  return [
    c.summary,
    ...(Array.isArray(c.skills) ? c.skills : []),
    ...roles.flatMap((r) => [r.title, r.company, ...(Array.isArray(r.bullets) ? r.bullets : [])]),
  ].filter(Boolean).join('\n');
}

// plural-tolerant word match: "campaign" evidences "campaigns" and vice versa
const tokenHits = (text, t) =>
  hasKeyword(text, t) ||
  hasKeyword(text, `${t}s`) ||
  (t.endsWith('s') && t.length > 3 && hasKeyword(text, t.slice(0, -1)));

// A requirement counts as covered when at least half of its significant
// tokens (minimum one) appear in the resume text.
export function computeCoverage(requirements, resumeContent) {
  const text = resumeText(resumeContent);
  const rows = (requirements || [])
    .filter((r) => typeof r === 'string' && r.trim())
    .map((req) => {
      const tokens = tokensOf(req);
      const matched = tokens.filter((t) => tokenHits(text, t));
      const generic = tokens.length === 0;
      const hit = !generic && matched.length >= Math.max(1, Math.ceil(tokens.length / 2));
      return { req, tokens, matched, hit, generic };
    });
  const scored = rows.filter((r) => !r.generic);
  return {
    rows,
    hits: scored.filter((r) => r.hit).length,
    total: scored.length,
  };
}
