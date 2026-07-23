// Posting-liveness classification — pure functions, no I/O. Ported from
// santifer/career-ops liveness-core/liveness-api, where every pattern below is
// accumulated field knowledge from real dead (and falsely-dead) postings.
//
// CONSERVATIVE BY DESIGN (upstream's words): a false "expired" is worse than
// the status quo — the user quietly loses a real job. So only hard evidence
// (404/410, an error=true redirect, an explicit taken-down banner, a listing
// page, a near-empty body) is ever 'expired'; everything ambiguous (bot walls,
// 403/503, identity-losing redirects, apply-less-but-substantial pages) is
// 'uncertain' and a human decides.

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
// '.' is in the charset, so the explicit '..' check is load-bearing
const safeSeg = (s) => s.length > 0 && SAFE_SEGMENT.test(s) && !s.includes('..');
const safePath = (v) => String(v).split('/').every(safeSeg);

// Map a posting URL to its ATS's public per-posting (or board) API. Returns
// null for unknown ATSes / non-https — the caller falls through to the HTML
// rung. Ashby is board-level: a 200 only proves the board exists, so the
// caller must interpret the body with classifyAshbyBoard (Ashby posting pages
// are JS-rendered — a static HTML check would false-report live postings as
// dead, so for Ashby the API rung is authoritative and there is no fallback).
export function resolveAtsApi(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const jobsIdx = parts.indexOf('jobs');
    const board = jobsIdx >= 1 ? parts[jobsIdx - 1] : null;
    const id = jobsIdx >= 0 ? parts[jobsIdx + 1] : null;
    if (board && id && safeSeg(board) && /^\d+$/.test(id)) {
      return { ats: 'greenhouse', apiUrl: `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}` };
    }
    return null;
  }
  const lever = host.match(/^jobs\.((?:eu\.)?lever\.co)$/); // preserve EU tenancy or EU postings 404 on the US host
  if (lever) {
    const [slug, id] = parts;
    if (slug && id && safeSeg(slug) && safeSeg(id)) {
      return { ats: 'lever', apiUrl: `https://api.${lever[1]}/v0/postings/${slug}/${id}` };
    }
    return null;
  }
  if (host === 'jobs.ashbyhq.com') {
    const [org, jobId] = parts;
    if (org && jobId && jobId !== 'application' && safeSeg(org) && safeSeg(jobId)) {
      return { ats: 'ashby', apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${org}`, jobId };
    }
    return null;
  }
  const wd = `${host}${u.pathname}`.match(/^([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)\/job\/(.+?)\/?$/);
  if (wd) {
    const [, tenant, shard, site, jobPath] = wd;
    if (safeSeg(tenant) && safeSeg(shard) && safeSeg(site) && safePath(jobPath)) {
      return { ats: 'workday', apiUrl: `https://${tenant}.${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/job/${jobPath}` };
    }
  }
  return null;
}

// Ashby's board feed: find the posting by id. Absent or isListed === false is
// a definitive removal; a shape we don't recognize degrades to null
// (inconclusive) — a future API change must never read as "expired".
export function classifyAshbyBoard(json, jobId) {
  if (!json || !Array.isArray(json.jobs)) return null;
  const id = String(jobId).toLowerCase();
  const job = json.jobs.find((j) => typeof j?.id === 'string' && j.id.toLowerCase() === id);
  if (job && job.isListed !== false) return { result: 'active', code: 'ashby_api_ok' };
  return { result: 'expired', code: 'ashby_api_unlisted', reason: 'Ashby posting not listed on the board — removed/unlisted' };
}

const BOT_CHALLENGE_PATTERNS = [
  /just a moment/i,
  /performing security verification/i,
  /checking your browser before/i,
  /verify you are (a |not a )?human/i,
  /enable javascript and cookies to continue/i,
  /attention required.*cloudflare/i,
  /\bray id\b/i,
  /\bcf-ray\b/i,
  /please complete the security check/i,
];

const EXPIRED_URL_PATTERNS = [/[?&]error=true/i]; // Lever/Greenhouse redirect dead postings here

const HARD_EXPIRED_PATTERNS = [
  /job (is )?no longer available/i,
  /job.*no longer open/i,
  /position has been filled/i,
  /this job has expired/i,
  /job posting has expired/i,
  /no longer accepting applications/i,
  /this (position|role|job) (is )?no longer/i,
  /this job (listing )?is closed/i,
  /job (listing )?not found/i,
  /the page you are looking for doesn.t exist/i, // '.' matches both apostrophe variants
  /applications?\s+(?:(?:have|are|is)\s+)?closed/i,
  /closed on \d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  /closed on (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}/i,
  /diese stelle (ist )?(nicht mehr|bereits) besetzt/i,
  /offre (expirée|n'est plus disponible)/i,
];

const APPLY_PATTERNS = [
  /\bapply\b/i, /\bsolicitar\b/i, /\bbewerben\b/i, /\bpostuler\b/i,
  /submit application/i, /easy apply/i, /start application/i, /ich bewerbe mich/i,
];

const LISTING_PAGE_PATTERNS = [/\d+\s+jobs?\s+found/i, /search for jobs page is loaded/i];

// UUID (Lever/Ashby) or 5+ digit req id (Greenhouse/Workday); the LAST token
// in the URL is the posting's identity
const JOB_ID_TOKEN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{5,}/gi;
const jobIdToken = (url) => {
  const m = String(url || '').match(JOB_ID_TOKEN);
  return m ? m[m.length - 1].toLowerCase() : null;
};

const MIN_CONTENT_CHARS = 300; // applied to TAG-STRIPPED text, never raw HTML

// Ordered decision cascade over a plain fetch's outcome. Ordering is
// load-bearing: the bot-challenge scan must precede the length/listing
// heuristics (a short challenge body reads as "dead" otherwise), and the
// redirect-identity check must precede the apply scan (a dead permalink that
// 301s to a listing page shows OTHER jobs' Apply buttons).
export function classifyLiveness({ status, requestedUrl, finalUrl, bodyText }) {
  const body = String(bodyText || '');

  if (status === 404 || status === 410) {
    return { result: 'expired', code: 'http_gone', reason: `HTTP ${status} — posting removed` };
  }
  if (BOT_CHALLENGE_PATTERNS.some((p) => p.test(body))) {
    return { result: 'uncertain', code: 'bot_challenge', reason: 'anti-bot challenge page — cannot verify from a server' };
  }
  if (status === 403 || status === 503) {
    return { result: 'uncertain', code: 'access_blocked', reason: `HTTP ${status} — access blocked, likely anti-bot (a removed posting returns 404/410)` };
  }
  // any other non-2xx (429, 500, 502, 504…) is transient or blocked — its
  // short error body must never reach the length heuristic and read as "gone"
  if (status != null && (status < 200 || status >= 300)) {
    return { result: 'uncertain', code: 'http_error', reason: `HTTP ${status} — transient or blocked, not proof the posting is gone` };
  }
  if (finalUrl && EXPIRED_URL_PATTERNS.some((p) => p.test(finalUrl))) {
    return { result: 'expired', code: 'expired_url', reason: 'redirected to an error URL — posting removed' };
  }
  const hard = HARD_EXPIRED_PATTERNS.find((p) => p.test(body));
  if (hard) {
    return { result: 'expired', code: 'expired_body', reason: `page says the posting is gone (${hard.source})` };
  }
  const reqToken = jobIdToken(requestedUrl);
  if (reqToken && finalUrl && !String(finalUrl).toLowerCase().includes(reqToken)) {
    return { result: 'uncertain', code: 'redirected_off_posting', reason: `redirected to ${finalUrl} — job id "${reqToken}" missing from final URL` };
  }
  if (APPLY_PATTERNS.some((p) => p.test(body))) {
    return { result: 'active', code: 'apply_control_visible', reason: 'apply control present' };
  }
  if (LISTING_PAGE_PATTERNS.some((p) => p.test(body))) {
    return { result: 'expired', code: 'listing_page', reason: 'landed on a search-results page, not the posting' };
  }
  // Upstream tuned this threshold against BROWSER-RENDERED text; on a static
  // fetch a legit JS-rendered career page also strips to near-nothing, so a
  // short body here is uncertainty, not death (deviation from upstream, safer).
  if (body.trim().length < MIN_CONTENT_CHARS) {
    return { result: 'uncertain', code: 'insufficient_content', reason: 'page has almost no static content — possibly JS-rendered; verify manually' };
  }
  return { result: 'uncertain', code: 'no_apply_control', reason: 'content present but no visible apply control' };
}

// three-state → jobs.posting_state column value
export const livenessToState = (result) =>
  ({ active: 'live', expired: 'gone', uncertain: 'uncertain' }[result] || 'uncertain');
