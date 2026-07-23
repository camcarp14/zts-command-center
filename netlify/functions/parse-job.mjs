// parse-job — turns a pasted URL or raw posting text into structured fields.
// The AI ONLY extracts; scoring stays deterministic and client-side. Never
// submits anything anywhere. Greenhouse/Lever/Ashby are read via their public
// JSON feeds (built for this); ToS-protected boards are refused with guidance.
import Anthropic from '@anthropic-ai/sdk';
import { requireUser, json, errorResponse } from './lib/auth.mjs';
import { stripHtml } from './lib/html.mjs';
import { classifyJobUrl, sourceLabel } from '../../apps/runway/src/lib/jobsource.js';

const MAX_TEXT = 60000;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`Feed returned HTTP ${res.status}`), { statusCode: 422 });
  return res.json();
}

// Resolve a classified URL to { text, sourceUrl } using public feeds where
// they exist, a single page fetch otherwise.
async function resolveUrl(cls, rawUrl) {
  if (cls.kind === 'greenhouse') {
    const j = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${cls.board}/jobs/${cls.jobId}?questions=false`);
    return { text: `${j.title || ''}\n${j.location?.name || ''}\n\n${stripHtml(j.content || '')}`, sourceUrl: j.absolute_url || rawUrl };
  }
  if (cls.kind === 'lever') {
    const j = await fetchJson(`https://api.lever.co/v0/postings/${cls.site}/${cls.id}`);
    const lists = (j.lists || []).map((l) => `${l.text}\n${stripHtml(l.content || '')}`).join('\n');
    return {
      text: `${j.text || ''}\n${j.categories?.location || ''}\n${j.categories?.commitment || ''}\n\n${j.descriptionPlain || stripHtml(j.description || '')}\n${lists}\n${j.salaryDescriptionPlain || ''}`,
      sourceUrl: j.hostedUrl || rawUrl,
    };
  }
  if (cls.kind === 'ashby') {
    const j = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${cls.org}?includeCompensation=true`);
    const job = (j.jobs || []).find((x) => x.id === cls.id || (x.jobUrl || '').includes(cls.id));
    if (!job) throw Object.assign(new Error('Posting not found on the Ashby board — it may be closed. Paste the text instead.'), { statusCode: 422 });
    return {
      text: `${job.title || ''}\n${job.location || ''}\n${job.compensation?.compensationTierSummary || ''}\n\n${job.descriptionPlain || stripHtml(job.descriptionHtml || '')}`,
      sourceUrl: job.jobUrl || rawUrl,
    };
  }
  // generic: one polite fetch of a public page — no crawling, no automation
  const res = await fetch(cls.url, {
    headers: { 'user-agent': 'Mozilla/5.0 (job-capture; personal single-user tool)', accept: 'text/html' },
    redirect: 'follow',
  });
  if (!res.ok) throw Object.assign(new Error(`That page returned HTTP ${res.status} — paste the description text instead.`), { statusCode: 422 });
  const html = await res.text();
  return { text: stripHtml(html), sourceUrl: cls.url };
}

const extractionTool = {
  name: 'record_extraction',
  description: 'Record the structured fields extracted from a job posting.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['company', 'title', 'comp_min', 'comp_max', 'location', 'remote_type', 'seniority', 'industry', 'requirements', 'flags', 'read_between_lines'],
    properties: {
      company: { type: ['string', 'null'], description: 'Employer name' },
      title: { type: ['string', 'null'], description: 'Job title as posted' },
      comp_min: { type: ['integer', 'null'], description: 'Lower bound of stated annual base comp in USD. Convert hourly rates to annual (x2080). null if not stated.' },
      comp_max: { type: ['integer', 'null'], description: 'Upper bound of stated annual base comp in USD. null if not stated.' },
      location: { type: ['string', 'null'], description: 'Primary location as stated' },
      remote_type: { type: 'string', enum: ['remote', 'hybrid', 'onsite', 'unknown'] },
      seniority: { type: 'string', enum: ['intern', 'junior', 'mid', 'senior', 'lead', 'manager', 'director', 'vp', 'exec', 'unknown'] },
      industry: { type: ['string', 'null'], description: "The employer's industry in 1-3 lowercase words, e.g. 'healthcare', 'adtech', 'gambling'" },
      requirements: { type: 'array', items: { type: 'string' }, description: 'Up to 10 core requirements, short phrases' },
      flags: {
        type: 'array',
        items: { type: 'string', enum: ['vague_comp', 'buzzword_heavy', 'unreasonable_requirements'] },
        description: 'Red flags that genuinely apply: vague_comp = no concrete numbers; buzzword_heavy = rockstar/ninja/fast-paced density; unreasonable_requirements = laundry-list or contradictory asks',
      },
      read_between_lines: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short skeptical observations a sharp candidate would want to know (e.g. "posting is 90% culture copy, 10% role definition")' },
    },
  },
};

const SYSTEM = `You extract structured data from job postings for a private job-search tracker.
Extract only what the posting actually says — never invent compensation numbers, and use null when a field is not stated.
Flags and read-between-the-lines notes should be honest and specific, not generic.`;

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
    await requireUser(event);

    if (!process.env.ANTHROPIC_API_KEY) {
      return json(500, { error: 'RUNWAY_ENV_MISSING: ANTHROPIC_API_KEY — set it in Netlify env vars and redeploy' });
    }

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { /* handled below */ }
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const pasted = typeof body.text === 'string' ? body.text.trim() : '';
    if (!url && !pasted) return json(400, { error: 'Provide a job URL or pasted description text' });

    let text = pasted;
    let sourceUrl = url || null;
    let source = 'paste';

    if (url) {
      const cls = classifyJobUrl(url);
      if (cls.kind === 'invalid') return json(400, { error: 'That does not look like a valid http(s) URL' });
      if (cls.kind === 'blocked') {
        return json(422, {
          error: `${cls.host} does not allow automated reading of postings — open the posting and paste the description text instead.`,
          blocked: true,
        });
      }
      const resolved = await resolveUrl(cls, url);
      text = resolved.text;
      sourceUrl = resolved.sourceUrl;
      source = sourceLabel(cls.kind);
    }

    text = String(text || '').slice(0, MAX_TEXT);
    if (text.length < 80) {
      return json(422, { error: "Couldn't read enough text from that source — paste the job description instead." });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: 2000,
      system: SYSTEM,
      tools: [extractionTool],
      tool_choice: { type: 'tool', name: 'record_extraction' },
      messages: [{ role: 'user', content: `Extract the structured fields from this job posting:\n\n${text}` }],
    });

    const toolUse = msg.content.find((b) => b.type === 'tool_use');
    if (!toolUse) return json(502, { error: 'Extraction produced no structured output — try again or enter it manually.' });

    return json(200, {
      extraction: toolUse.input,
      source,
      source_url: sourceUrl,
      raw_text: text,
      chars: text.length,
    });
  } catch (ex) {
    return errorResponse(ex);
  }
};
