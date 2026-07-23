// Job-source URL classification — shared by the parse-job function (fetching)
// and the client (pre-warning about blocked hosts before a round trip).
// Every watchable provider here publishes a public no-auth feed meant for
// exactly this use (JSON, RSS, XML, or markdown — see functions/lib/providers).
// LinkedIn/Indeed/Glassdoor prohibit scraping in their ToS — we refuse and ask
// for pasted text instead. Provider set ported from santifer/career-ops, which
// keeps the same ToS line: no LinkedIn/Indeed provider exists there either.

export const BLOCKED_HOSTS = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com'];

// Watchable board providers. `sub`-style providers key the tenant off a
// subdomain; `path`-style off the first path segment. Workday is composite
// (tenant.instance/site) and only watchable by pasting a board URL.
export const BOARD_PROVIDERS = [
  'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee',
  'breezy', 'rippling', 'bamboohr', 'jobvite', 'pinpoint', 'teamtailor',
  'personio', 'workday',
];

// DNS-label-strict tenant slug (no leading/trailing hyphen) — the anchored
// shape is also the SSRF guard for subdomain-keyed feeds.
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const subSlug = (host, suffix) => {
  if (!host.endsWith(suffix)) return null;
  const sub = host.slice(0, -suffix.length);
  return SAFE_SLUG.test(sub) ? sub : null;
};

export function classifyJobUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return { kind: 'invalid' };
  }
  if (!/^https?:$/.test(u.protocol)) return { kind: 'invalid' };
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  const blocked = BLOCKED_HOSTS.find((b) => host === b || host.endsWith(`.${b}`));
  if (blocked) return { kind: 'blocked', host: blocked };

  // boards.greenhouse.io/<board>/jobs/<id> or job-boards.greenhouse.io/<board>/jobs/<id>
  if (host.endsWith('greenhouse.io')) {
    const jobsIdx = parts.indexOf('jobs');
    if (jobsIdx >= 1 && parts[jobsIdx + 1]) {
      return { kind: 'greenhouse', board: parts[jobsIdx - 1], jobId: parts[jobsIdx + 1] };
    }
    return { kind: 'generic', url: u.href };
  }

  // jobs.lever.co/<site>/<posting-id> (also jobs.eu.lever.co)
  if (host.endsWith('lever.co')) {
    if (parts.length >= 2) return { kind: 'lever', site: parts[0], id: parts[1] };
    return { kind: 'generic', url: u.href };
  }

  // jobs.ashbyhq.com/<org>/<posting-id>
  if (host.endsWith('ashbyhq.com')) {
    if (parts.length >= 2) return { kind: 'ashby', org: parts[0], id: parts[1] };
    return { kind: 'generic', url: u.href };
  }

  return { kind: 'generic', url: u.href };
}

// jobs.source values by classification
export const sourceLabel = (kind) =>
  ({ greenhouse: 'greenhouse', lever: 'lever', ashby: 'ashby', generic: 'url' }[kind] || 'paste');

// Candidate feed slugs for a typed company name — "Cardinal Health" probes
// cardinalhealth and cardinal-health. Pure; exercised by the smoke test.
export function slugCandidates(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!base) return [];
  const words = base.split(' ');
  return [...new Set([words.join(''), words.join('-')])];
}

// Board-level classification for the scan watchlist: accepts ANY url on a
// provider's board — the board root or a single posting — and returns the
// whole board to watch. Only providers with a public no-auth feed are
// watchable (14 of them; see BOARD_PROVIDERS).
export function classifyBoardUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return { ok: false, reason: 'That does not look like a valid URL.' };
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: 'That does not look like a valid URL.' };
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  const blocked = BLOCKED_HOSTS.find((b) => host === b || host.endsWith(`.${b}`));
  if (blocked) return { ok: false, reason: `${blocked} can't be watched (no public feed, scraping prohibited).` };

  if (host.endsWith('greenhouse.io')) {
    // boards.greenhouse.io/<board>[/jobs/<id>] — board is the segment before /jobs
    const jobsIdx = parts.indexOf('jobs');
    const board = jobsIdx > 0 ? parts[jobsIdx - 1] : parts[0];
    if (board) return { ok: true, provider: 'greenhouse', board };
  }
  if (host.endsWith('lever.co') && parts[0]) {
    return { ok: true, provider: 'lever', board: parts[0] };
  }
  if (host.endsWith('ashbyhq.com') && parts[0]) {
    return { ok: true, provider: 'ashby', board: parts[0] };
  }
  // careers|jobs.smartrecruiters.com/<company>[/<posting>]
  if ((host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') && parts[0]) {
    return { ok: true, provider: 'smartrecruiters', board: parts[0] };
  }
  // apply.workable.com/<slug>[/j/<shortcode>]
  if (host === 'apply.workable.com' && parts[0] && SAFE_SLUG.test(parts[0])) {
    return { ok: true, provider: 'workable', board: parts[0].toLowerCase() };
  }
  // ats.rippling.com/<slug>/jobs[/<id>]
  if (host === 'ats.rippling.com' && parts[0] && SAFE_SLUG.test(parts[0])) {
    return { ok: true, provider: 'rippling', board: parts[0] };
  }
  // jobs.jobvite.com/<companyId>[/job/<id>]
  if (host === 'jobs.jobvite.com' && parts[0] && parts[0] !== 'api' && SAFE_SLUG.test(parts[0])) {
    return { ok: true, provider: 'jobvite', board: parts[0] };
  }
  // subdomain-keyed tenants: <slug>.<provider-domain>
  const subProviders = [
    ['.recruitee.com', 'recruitee'],
    ['.breezy.hr', 'breezy'],
    ['.bamboohr.com', 'bamboohr'],
    ['.pinpointhq.com', 'pinpoint'],
    ['.teamtailor.com', 'teamtailor'],
    ['.jobs.personio.de', 'personio'],
    ['.jobs.personio.com', 'personio'],
  ];
  for (const [suffix, provider] of subProviders) {
    const sub = subSlug(host, suffix);
    if (sub && sub !== 'www' && !sub.includes('.')) return { ok: true, provider, board: sub.toLowerCase() };
  }
  // <tenant>.<wdN>.myworkdayjobs.com/[<locale>/]<site>/... → composite board
  // "tenant.instance/site" (the CXS feed needs all three parts)
  const wd = host.match(/^([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com$/);
  if (wd) {
    const rest = parts[0] && /^[a-z]{2}-[A-Z]{2}$/.test(parts[0]) ? parts.slice(1) : parts;
    const site = rest[0];
    if (site && /^[A-Za-z0-9._-]+$/.test(site) && !site.includes('..')) {
      return { ok: true, provider: 'workday', board: `${wd[1]}.${wd[2]}/${site}` };
    }
    return { ok: false, reason: 'That looks like Workday — paste the board URL including the site name, e.g. https://acme.wd5.myworkdayjobs.com/careers' };
  }
  return {
    ok: false,
    reason: 'Watching works for Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Breezy, Rippling, BambooHR, Jobvite, Pinpoint, Teamtailor, Personio, and Workday boards (they publish public feeds). Paste any URL from the company’s board.',
  };
}
