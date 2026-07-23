// tailor — drafts re-emphasized resume bullets or a cover letter for one job,
// grounded in the stored master resume. Output is an editable DRAFT returned
// to the client; nothing is ever sent anywhere on the user's behalf.
import Anthropic from '@anthropic-ai/sdk';
import { requireUser, json, errorResponse } from './lib/auth.mjs';

const SYSTEMS = {
  prep_brief: `You build interview prep briefs for a job seeker. You receive their master resume (the ground truth) and a target job posting.
Output markdown with EXACTLY these sections:
## Role snapshot — 3 bullets on what this role actually is, judging from the posting's own language (read between the lines).
## Likely interview questions — 8-10 questions THIS posting implies (mix behavioral and role-specific), each with a one-line note on what the interviewer is really probing.
## Your stories — 4-6 STAR-ready stories mapped FROM THE RESUME to this posting's needs. Title each story, cite the resume bullet it comes from, and give one line on how to angle it for this role.
## Gaps and how to handle them — requirements the resume doesn't clearly demonstrate; for each, an honest talking point (adjacent experience, transferable evidence, or a learning plan). Never advise exaggerating or lying.
## Questions to ask them — 5 sharp questions that signal seniority, specific to this company and role (no generic "what's the culture like").
HARD RULES: ground every story and claim in the actual resume; never invent experience, metrics, or skills.`,
  outreach_note: `You draft outreach for a job seeker. You receive their master resume (the ground truth) and a target job posting.
Output markdown with EXACTLY these sections:
## Email to the recruiter or hiring manager — 110-160 words. A specific hook about the company or role (no flattery padding), one concrete proof point from the resume mapped to their stated need, and a low-friction ask (15-minute chat, or confirming an application landed). No "I hope this finds you well", no "I am writing to express".
## LinkedIn connection note — under 280 characters, the same idea compressed. Plain, confident, zero buzzwords.
HARD RULES: facts only from the resume. The user sends these themselves — write in their voice, never imply anything was already sent.`,
  resume_bullets: `You tailor resumes for a job seeker. You receive their master resume (the ground truth) and a target job posting.
Select the most relevant skills and experience bullets, reorder them, and rewrite each bullet to mirror the posting's own language where that is honest.
HARD RULES: never invent employers, titles, dates, tools, metrics, or skills that are not in the master resume. Rewording is fine; fabrication is not.
Output clean markdown:
- one "**Lead with:**" line of 4-6 skills to emphasize
- a section per relevant role (company — title, dates) with 3-5 tailored bullets
- a final "**Cut or de-emphasize:**" line naming resume items least relevant to this posting.`,
  cover_letter: `You write cover letters for a job seeker. You receive their master resume (the ground truth) and a target job posting.
Write a tight 250-320 word cover letter in a confident, plain voice. No "I am writing to express my interest", no buzzwords, no flattery padding.
Structure: a specific opening tied to the company or role, two short paragraphs mapping their actual experience to the posting's stated needs (use real evidence from the resume), and a direct close.
HARD RULES: never invent experience, metrics, or skills not present in the master resume. Output plain text only — no subject line, no address block.`,
};

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
    const { supa } = await requireUser(event);

    if (!process.env.ANTHROPIC_API_KEY) {
      return json(500, { error: 'RUNWAY_ENV_MISSING: ANTHROPIC_API_KEY — set it in Netlify env vars and redeploy' });
    }

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { /* handled below */ }
    const kind = String(body.kind || '');
    const jobId = String(body.job_id || '');
    if (!SYSTEMS[kind]) return json(400, { error: `kind must be one of: ${Object.keys(SYSTEMS).join(', ')}` });
    if (!jobId) return json(400, { error: 'job_id is required' });

    // both reads run under the caller's own token — RLS applies
    const [{ data: job, error: jobErr }, { data: resume, error: resErr }] = await Promise.all([
      supa.from('jobs').select('*').eq('id', jobId).maybeSingle(),
      supa.from('resume_master').select('content').maybeSingle(),
    ]);
    if (jobErr) return json(500, { error: `Couldn't load the job: ${jobErr.message}` });
    if (resErr) return json(500, { error: `Couldn't load the resume: ${resErr.message}` });
    if (!job) return json(404, { error: 'Job not found' });
    if (!resume || !resume.content || Object.keys(resume.content).length === 0) {
      return json(422, { error: 'No master resume yet — add it on the Profile page first, then generate drafts.' });
    }

    const posting = [
      `Company: ${job.company}`,
      `Title: ${job.title}`,
      job.location && `Location: ${job.location}`,
      job.remote_type !== 'unknown' && `Work mode: ${job.remote_type}`,
      job.industry && `Industry: ${job.industry}`,
      Array.isArray(job.requirements) && job.requirements.length ? `Core requirements: ${job.requirements.join('; ')}` : null,
      '',
      job.raw_description ? `Full posting:\n${String(job.raw_description).slice(0, 30000)}` : '(no full posting text captured)',
    ].filter(Boolean).join('\n');

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: kind === 'prep_brief' ? 4000 : 3000,
      thinking: { type: 'adaptive' },
      system: SYSTEMS[kind],
      messages: [{
        role: 'user',
        content: `MASTER RESUME (ground truth):\n${JSON.stringify(resume.content, null, 2)}\n\n---\n\nTARGET POSTING:\n${posting}`,
      }],
    });

    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) return json(502, { error: 'Draft came back empty — try again.' });

    return json(200, { content: text, kind });
  } catch (ex) {
    return errorResponse(ex);
  }
};
