// find-board — turns a typed company NAME into its watchable job board by
// probing the public feed providers for likely slugs. Read-only probes of
// feeds published for public consumption; nothing is scraped. Provider census
// ported from santifer/career-ops. Workday is the one watchable provider that
// can't be name-probed (tenant.instance/site is not derivable from a name) —
// paste its board URL instead.
import { requireUser, json, errorResponse } from './lib/auth.mjs';
import { slugCandidates } from '../../apps/runway/src/lib/jobsource.js';

const TIMEOUT_MS = 6000;

const get = async (url, type = 'json') => {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) return null;
  return type === 'json' ? r.json() : r.text();
};

// Each probe returns a posting count or null (no board). The original three
// report any live board; the newer providers require count > 0, because some
// multi-tenant hosts answer 200 with an empty feed for slugs that don't exist.
const PROBES = {
  greenhouse: async (slug) => {
    const j = await get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    return Array.isArray(j?.jobs) ? j.jobs.length : null;
  },
  lever: async (slug) => {
    const j = await get(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    return Array.isArray(j) ? j.length : null;
  },
  ashby: async (slug) => {
    const j = await get(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    return Array.isArray(j?.jobs) ? j.jobs.length : null;
  },
  smartrecruiters: async (slug) => {
    const j = await get(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1&offset=0&status=PUBLIC`);
    const n = Number(j?.totalFound ?? (Array.isArray(j?.content) ? j.content.length : NaN));
    return Number.isFinite(n) && n > 0 ? n : null;
  },
  workable: async (slug) => {
    const t = await get(`https://apply.workable.com/${slug}/jobs.md`, 'text');
    if (typeof t !== 'string') return null;
    const n = t.split('\n').filter((l) => l.startsWith('|') && l.includes('[View]')).length;
    return n > 0 ? n : null;
  },
  recruitee: async (slug) => {
    const j = await get(`https://${slug}.recruitee.com/api/offers/`);
    return Array.isArray(j?.offers) && j.offers.length > 0 ? j.offers.length : null;
  },
  breezy: async (slug) => {
    const j = await get(`https://${slug}.breezy.hr/json`);
    return Array.isArray(j) && j.length > 0 ? j.length : null;
  },
  rippling: async (slug) => {
    const j = await get(`https://api.rippling.com/platform/api/ats/v1/board/${slug}/jobs`);
    return Array.isArray(j) && j.length > 0 ? j.length : null;
  },
  bamboohr: async (slug) => {
    const j = await get(`https://${slug}.bamboohr.com/careers/list`);
    return Array.isArray(j?.result) && j.result.length > 0 ? j.result.length : null;
  },
  jobvite: async (slug) => {
    const j = await get(`https://jobs.jobvite.com/api/company/${slug}/jobs`);
    return Array.isArray(j?.jobs) && j.jobs.length > 0 ? j.jobs.length : null;
  },
  pinpoint: async (slug) => {
    const j = await get(`https://${slug}.pinpointhq.com/postings.json`);
    return Array.isArray(j?.data) && j.data.length > 0 ? j.data.length : null;
  },
  teamtailor: async (slug) => {
    const t = await get(`https://${slug}.teamtailor.com/jobs.rss`, 'text');
    if (typeof t !== 'string') return null;
    const n = (t.match(/<item\b/gi) || []).length;
    return n > 0 ? n : null;
  },
  personio: async (slug) => {
    // a nonexistent tenant throws (NXDOMAIN) on .de — still try .com
    for (const tld of ['de', 'com']) {
      try {
        const t = await get(`https://${slug}.jobs.personio.${tld}/xml`, 'text');
        if (typeof t === 'string') {
          const n = (t.match(/<position\b/g) || []).length;
          if (n > 0) return n;
        }
      } catch { /* try the next tld */ }
    }
    return null;
  },
};

async function probe(provider, slug) {
  try {
    const count = await PROBES[provider](slug);
    return count != null ? { provider, board: slug, count } : null;
  } catch { return null; } // dead probe = no hit
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
    await requireUser(event);

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { /* handled below */ }
    const name = String(body.name || '').trim();
    if (!name) return json(400, { error: 'Provide a company name' });

    const slugs = slugCandidates(name).slice(0, 3);
    if (!slugs.length) return json(400, { error: 'Could not derive a board name from that input' });

    const probes = [];
    for (const slug of slugs) {
      for (const provider of Object.keys(PROBES)) {
        probes.push(probe(provider, slug));
      }
    }
    const results = await Promise.all(probes);

    const seen = new Set();
    const hits = results.filter(Boolean).filter((h) => {
      const key = `${h.provider}|${h.board}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return json(200, { name, hits });
  } catch (ex) {
    return errorResponse(ex);
  }
};
