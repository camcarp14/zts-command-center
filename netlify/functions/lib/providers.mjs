// Board feed adapters — one public, no-auth feed per ATS provider, normalized
// to the scan contract: [{ external_id, title, url, location, text|null,
// needsDetail }]. Ported from santifer/career-ops (MIT), which battle-tested
// every endpoint, parser, and edge case here in production; persistence and
// CLI layers were left behind, the fetch/parse logic ports verbatim.
//
// ToS line (same as career-ops): every endpoint below is published for public
// consumption. No LinkedIn/Indeed/Glassdoor — they prohibit scraping.
//
// Parsers are exported individually so the smoke test can plant real captured
// payloads against them without any network.
import { stripHtml } from './html.mjs';

const FEED_TIMEOUT_MS = 15000;

// DNS-label-strict tenant slug — the anchored shape is the SSRF guard for
// subdomain-keyed feeds (the slug becomes part of the hostname).
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
// path-segment guard for composite boards (workday): '.' is in the charset so
// the explicit '..' check is load-bearing, not paranoia.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const safeSegment = (s) => SAFE_SEGMENT.test(s) && !s.includes('..');

// Some WAF-fronted hosts (Workday CXS) 500/429 bare server-side requests; a
// browser-like UA + origin/referer clears it (career-ops, verified on live
// tenants). Harmless everywhere else.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function feedJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || FEED_TIMEOUT_MS),
    ...(opts.redirect ? { redirect: opts.redirect } : {}),
    ...(opts.method ? { method: opts.method, body: opts.body } : {}),
  });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  return res.json();
}

async function feedText(url, opts = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs || FEED_TIMEOUT_MS),
    ...(opts.redirect ? { redirect: opts.redirect } : {}),
  });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  return res.text();
}

// keep only well-formed absolute https links; optionally pin the host
const httpsUrl = (value, host = null) => {
  if (!value) return null;
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== 'https:') return null;
    if (host && u.hostname !== host) return null;
    return u.href;
  } catch { return null; }
};

const assertSlug = (provider, slug) => {
  if (!SAFE_SLUG.test(String(slug || ''))) throw new Error(`${provider}: invalid board "${slug}"`);
  return slug;
};

// ---------------- XML/RSS helpers (teamtailor, personio) ----------------
// Tiny tag extractor instead of an XML dependency — same approach career-ops
// ships. Numeric entities decode first; &amp; decodes LAST so a literal
// "&amp;lt;" yields "&lt;" rather than over-decoding to "<".
const fromCodePoint = (cp) => { try { return String.fromCodePoint(cp); } catch { return ''; } };
function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function extractXmlText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeXmlEntities(inner).trim();
}
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractXmlText(m[1]) : '';
}

// ---------------- pure parsers (smoke-tested against real payloads) ----------------

// SmartRecruiters: {content:[{id, name, ref, location}]}. j.ref points at the
// API host — rewrite to the public jobs.smartrecruiters.com URL or every
// posting link 404s (career-ops #1612).
export function parseSmartRecruiters(json, board) {
  const items = Array.isArray(json?.content) ? json.content : [];
  return items.filter((j) => j?.id && j?.name).map((j) => {
    const loc = j.location || {};
    const base = loc.fullLocation || [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
    const location = [base, loc.remote ? 'Remote' : ''].filter(Boolean).join(', ') || null;
    const titleSlug = String(j.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let slug = board;
    const ref = typeof j.ref === 'string' ? j.ref.match(/^https:\/\/api\.smartrecruiters\.com\/v1\/companies\/([^/]+)\/postings\//) : null;
    if (ref) slug = ref[1];
    return {
      external_id: String(j.id), title: j.name, location,
      url: `https://jobs.smartrecruiters.com/${slug}/${j.id}${titleSlug ? `-${titleSlug}` : ''}`,
      text: null, needsDetail: false,
    };
  });
}

// Workable jobs.md: markdown table | Title | Dept | Location | Type | Salary |
// Posted | [View](url.md) |. Type/Salary/Posted feed the deterministic
// extractors for free (career-ops ignores them; we harvest).
export function parseWorkableMarkdown(text) {
  if (typeof text !== 'string') return [];
  const jobs = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || !line.includes('[View]')) continue;
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length < 8) continue;
    const title = cols[1];
    if (!title || title === 'Title') continue;
    const m = line.match(/\[View\]\(([^)]+)\)/);
    let url = m ? m[1] : '';
    if (url.endsWith('.md')) url = url.slice(0, -3);
    url = httpsUrl(url, 'apply.workable.com');
    if (!url) continue;
    const id = new URL(url).pathname.split('/').filter(Boolean).pop();
    jobs.push({
      external_id: id || url, title, url, location: cols[3] || null,
      text: [cols[4], cols[5]].filter(Boolean).join('\n') || null, needsDetail: false,
    });
  }
  return jobs;
}

// Recruitee: {offers:[...]}. Posting URLs commonly live on branded domains, so
// the link is https-validated but not host-pinned (display/dedup only).
export function parseRecruitee(json) {
  const items = Array.isArray(json?.offers) ? json.offers : [];
  return items.filter((j) => j?.title).map((j) => ({
    external_id: String(j.id ?? j.slug ?? j.careers_url ?? j.url ?? j.title),
    title: j.title,
    url: httpsUrl(j.careers_url) || httpsUrl(j.url),
    location: j.location || [j.city, j.country, j.remote ? 'Remote' : ''].filter(Boolean).join(', ') || null,
    text: null, needsDetail: false,
  }));
}

// Breezy: top-level array; j.url is the canonical posting link (host-pinned).
export function parseBreezy(json, board) {
  const items = Array.isArray(json) ? json : [];
  return items.filter((j) => j?.name).map((j) => {
    const url = httpsUrl(j.url, `${board}.breezy.hr`);
    if (!url) return null;
    const loc = j.location || {};
    let base = loc.name || [loc.city, loc.state, loc.country?.name].filter(Boolean).join(', ');
    if (loc.is_remote && !/remote/i.test(base)) base = [base, 'Remote'].filter(Boolean).join(', ');
    return { external_id: url, title: j.name, url, location: base || null, text: null, needsDetail: false };
  }).filter(Boolean);
}

// Rippling: array of {uuid, name, url, workLocation}. No custom-domain case —
// off-host URLs are untrusted and dropped.
export function parseRippling(json) {
  const items = Array.isArray(json) ? json : [];
  return items.filter((j) => j?.name && j?.uuid).map((j) => ({
    external_id: String(j.uuid), title: String(j.name).trim(),
    url: httpsUrl(j.url, 'ats.rippling.com'),
    location: (typeof j.workLocation === 'string' ? j.workLocation : j.workLocation?.label) || null,
    text: null, needsDetail: false,
  }));
}

// BambooHR: {result:[{id, jobOpeningName, location, isRemote}]}. URL is built
// from the tenant origin + id (matches the public share URL); blank ids are
// dropped — '/careers/' would collapse dedup keys.
export function parseBambooHR(json, board) {
  const items = Array.isArray(json?.result) ? json.result : [];
  return items.filter((j) => j?.jobOpeningName && String(j.id ?? '').length > 0).map((j) => ({
    external_id: String(j.id),
    title: j.jobOpeningName,
    url: `https://${board}.bamboohr.com/careers/${encodeURIComponent(String(j.id))}`,
    location: [j.location?.city, j.location?.state, j.isRemote ? 'Remote' : ''].filter(Boolean).join(', ') || null,
    text: null, needsDetail: false,
  }));
}

// Jobvite: {jobs:[{id, title, location, country, date, applyURL}]}. Per-job
// URLs commonly live on branded subdomains — https-validated, not host-pinned.
export function parseJobvite(json) {
  const items = Array.isArray(json?.jobs) ? json.jobs : [];
  return items.filter((j) => j?.title).map((j) => ({
    external_id: String(j.id ?? j.applyURL ?? j.title),
    title: j.title,
    url: httpsUrl(j.applyURL),
    location: j.location || j.country || null,
    text: null, needsDetail: false,
  }));
}

// Pinpoint: {data:[{title, url, location, compensation}]}. Compensation rides
// into text so the deterministic comp extractor sees it.
export function parsePinpoint(json) {
  const items = Array.isArray(json?.data) ? json.data : [];
  return items.filter((j) => j?.title).map((j) => {
    const url = httpsUrl(j.url);
    return {
      external_id: String(j.id ?? j.path ?? url ?? j.title),
      title: String(j.title).trim(), url,
      location: j.location?.name || [j.location?.city, j.location?.province].filter(Boolean).join(', ') || null,
      text: typeof j.compensation === 'string' && j.compensation ? j.compensation : null,
      needsDetail: false,
    };
  });
}

// Teamtailor RSS: <item> blocks with <title>, <link>, tt: location tags.
// Job links commonly live on branded domains — https-only, not host-pinned.
export function parseTeamtailorRss(xml) {
  if (typeof xml !== 'string') return [];
  const jobs = [];
  for (const item of xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || []) {
    const url = httpsUrl(tagText(item, 'link'));
    const title = tagText(item, 'title');
    if (!url || !title) continue;
    const place = [tagText(item, 'tt:city'), tagText(item, 'tt:country')].filter(Boolean).join(', ');
    const remote = tagText(item, 'remoteStatus').toLowerCase();
    jobs.push({
      external_id: url, title, url,
      location: place || (remote === 'fully' || remote === 'temporary' ? 'Remote' : null),
      text: null, needsDetail: false,
    });
  }
  return jobs;
}

// Personio XML: <position> blocks. The <jobDescriptions> subtree is stripped
// from the WHOLE document first — descriptions are free HTML that can carry a
// literal "</position>" (truncates the block match) and nested <name> tags
// (race the position's own <name>). Hard-won upstream; do not remove.
export function parsePersonioXml(xml, host) {
  if (typeof xml !== 'string') return [];
  const stripped = xml.replace(/<jobDescriptions\b[^>]*>[\s\S]*?<\/jobDescriptions>/gi, '');
  const jobs = [];
  for (const block of stripped.match(/<position\b[^>]*>[\s\S]*?<\/position>/g) || []) {
    const title = tagText(block, 'name');
    const id = tagText(block, 'id');
    if (!title || !/^\d+$/.test(id)) continue; // clean numeric id builds the url
    const seen = new Set();
    const offices = [];
    for (const om of block.matchAll(/<office\b[^>]*>([\s\S]*?)<\/office>/g)) {
      const name = extractXmlText(om[1]);
      if (name && !seen.has(name)) { seen.add(name); offices.push(name); }
    }
    jobs.push({
      external_id: id, title, url: `https://${host}/job/${id}`,
      location: offices.join(', ') || null, text: null, needsDetail: false,
    });
  }
  return jobs;
}

// Workday CXS page: {jobPostings:[{title, externalPath, locationsText}]}.
// externalPath is relative to the SITE, not the host root — the site segment
// in jobBase is mandatory or every URL 404s.
export function parseWorkdayPage(json, jobBase) {
  const items = Array.isArray(json?.jobPostings) ? json.jobPostings : [];
  return items.filter((j) => j?.externalPath && String(j.title || '').trim()).map((j) => {
    const pathLoc = String(j.externalPath).match(/\/job\/([^/]+)\//);
    return {
      external_id: String(j.externalPath),
      title: String(j.title).trim(),
      url: jobBase + j.externalPath,
      location: j.locationsText || (pathLoc ? pathLoc[1].replace(/-/g, ' ') : null),
      text: null, needsDetail: false,
    };
  });
}

// ---------------- fetchers ----------------

const SR_PAGE_SIZE = 100;
const SR_MAX_PAGES = 3;      // 300 newest postings per scan — function-budget cap
const WD_PAGE_SIZE = 20;     // fixed by the CXS API
const WD_MAX_PAGES = 5;      // 100 newest postings per scan — function-budget cap
const WD_INTER_PAGE_DELAY_MS = 150; // WAF-friendly pacing within one tenant

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSmartRecruiters(board) {
  if (!/^[A-Za-z0-9._-]+$/.test(board)) throw new Error(`smartrecruiters: invalid board "${board}"`);
  const all = [];
  for (let page = 0; page < SR_MAX_PAGES; page++) {
    const j = await feedJson(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board)}/postings?limit=${SR_PAGE_SIZE}&offset=${page * SR_PAGE_SIZE}&status=PUBLIC`,
      { redirect: 'error' },
    );
    const parsed = parseSmartRecruiters(j, board);
    all.push(...parsed);
    // short-page check on the RAW payload — parsed drops malformed rows, and
    // a filtered count would end pagination early on a full page
    const raw = Array.isArray(j?.content) ? j.content.length : 0;
    if (raw < SR_PAGE_SIZE) break;
  }
  return all;
}

async function fetchWorkday(board) {
  // composite board "tenant.instance/site" (from classifyBoardUrl)
  const m = String(board).match(/^([\w-]+)\.(wd[\w-]*)\/(.+)$/);
  if (!m || !safeSegment(m[3])) throw new Error(`workday: invalid board "${board}" (expected tenant.instance/site)`);
  const [, tenant, instance, site] = m;
  const origin = `https://${tenant}.${instance}.myworkdayjobs.com`;
  const jobBase = `${origin}/${site}`;
  const headers = {
    'content-type': 'application/json', accept: 'application/json',
    'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9',
    origin, referer: `${jobBase}/`,
  };
  const all = [];
  for (let page = 0; page < WD_MAX_PAGES; page++) {
    if (page > 0) await sleep(WD_INTER_PAGE_DELAY_MS);
    const j = await feedJson(`${origin}/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST', headers,
      body: JSON.stringify({ limit: WD_PAGE_SIZE, offset: page * WD_PAGE_SIZE, searchText: '', appliedFacets: {} }),
    });
    const parsed = parseWorkdayPage(j, jobBase);
    all.push(...parsed);
    const total = Number(j?.total);
    // short-page check on the RAW payload (parsed drops title-less rows)
    const raw = Array.isArray(j?.jobPostings) ? j.jobPostings.length : 0;
    if (raw < WD_PAGE_SIZE) break;
    if (Number.isFinite(total) && (page + 1) * WD_PAGE_SIZE >= total) break;
  }
  return all;
}

async function fetchPersonio(board) {
  assertSlug('personio', board);
  // DACH tenants live on .de, others on .com — try .de first, fall back
  let lastErr;
  for (const tld of ['de', 'com']) {
    const host = `${board}.jobs.personio.${tld}`;
    try {
      const xml = await feedText(`https://${host}/xml`, { redirect: 'error' });
      return parsePersonioXml(xml, host);
    } catch (ex) { lastErr = ex; }
  }
  throw lastErr;
}

// → [{ external_id, title, url, location, text|null, needsDetail }]
export async function fetchBoard(provider, board) {
  if (provider === 'greenhouse') {
    const j = await feedJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`);
    return (j.jobs || []).map((x) => ({
      external_id: String(x.id),
      title: x.title || '',
      url: x.absolute_url || null,
      location: x.location?.name || null,
      text: null,
      needsDetail: true, // list feed has no description; fetched only for matches
    }));
  }
  if (provider === 'lever') {
    const j = await feedJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
    return (Array.isArray(j) ? j : []).map((x) => ({
      external_id: String(x.id),
      title: x.text || '',
      url: x.hostedUrl || null,
      location: x.categories?.location || null,
      text: [x.categories?.commitment, x.descriptionPlain, x.salaryDescriptionPlain,
        ...(x.lists || []).map((l) => `${l.text}\n${stripHtml(l.content || '')}`)].filter(Boolean).join('\n'),
      needsDetail: false,
    }));
  }
  if (provider === 'ashby') {
    const j = await feedJson(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`);
    return (j.jobs || []).map((x) => ({
      external_id: String(x.id),
      title: x.title || '',
      url: x.jobUrl || null,
      location: x.location || null,
      text: [x.compensation?.compensationTierSummary, x.descriptionPlain || stripHtml(x.descriptionHtml || '')].filter(Boolean).join('\n'),
      needsDetail: false,
    }));
  }
  if (provider === 'smartrecruiters') return fetchSmartRecruiters(board);
  if (provider === 'workday') return fetchWorkday(board);
  if (provider === 'personio') return fetchPersonio(board);
  if (provider === 'workable') {
    assertSlug('workable', board);
    return parseWorkableMarkdown(await feedText(`https://apply.workable.com/${board}/jobs.md`, { redirect: 'error' }));
  }
  if (provider === 'recruitee') {
    assertSlug('recruitee', board);
    return parseRecruitee(await feedJson(`https://${board}.recruitee.com/api/offers/`, { redirect: 'error' }));
  }
  if (provider === 'breezy') {
    assertSlug('breezy', board);
    return parseBreezy(await feedJson(`https://${board}.breezy.hr/json`, { redirect: 'error' }), board);
  }
  if (provider === 'rippling') {
    assertSlug('rippling', board);
    return parseRippling(await feedJson(`https://api.rippling.com/platform/api/ats/v1/board/${board}/jobs`, { redirect: 'error' }));
  }
  if (provider === 'bamboohr') {
    assertSlug('bamboohr', board);
    return parseBambooHR(await feedJson(`https://${board}.bamboohr.com/careers/list`, { redirect: 'error' }), board);
  }
  if (provider === 'jobvite') {
    assertSlug('jobvite', board);
    return parseJobvite(await feedJson(`https://jobs.jobvite.com/api/company/${board}/jobs`, { redirect: 'error' }));
  }
  if (provider === 'pinpoint') {
    assertSlug('pinpoint', board);
    return parsePinpoint(await feedJson(`https://${board}.pinpointhq.com/postings.json`, { redirect: 'error' }));
  }
  if (provider === 'teamtailor') {
    assertSlug('teamtailor', board);
    return parseTeamtailorRss(await feedText(`https://${board}.teamtailor.com/jobs.rss`, { redirect: 'error' }));
  }
  throw new Error(`unknown provider ${provider}`);
}

export async function greenhouseDetail(board, id) {
  const j = await feedJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?questions=false`);
  return stripHtml(j.content || '');
}
