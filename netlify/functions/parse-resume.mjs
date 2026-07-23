// parse-resume — structures a pasted resume into the master-resume shape.
// Faithful restructuring only: the model must not invent or embellish, and
// the result lands in the editor for review — nothing saves automatically.
import Anthropic from '@anthropic-ai/sdk';
import { requireUser, json, errorResponse } from './lib/auth.mjs';

const resumeTool = {
  name: 'record_resume',
  description: 'Record the structured form of a resume.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['contact', 'summary', 'skills', 'experience'],
    properties: {
      contact: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'phone', 'location', 'links'],
        properties: {
          name: { type: ['string', 'null'] },
          email: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'] },
          location: { type: ['string', 'null'] },
          links: { type: 'array', items: { type: 'string' }, description: 'LinkedIn/portfolio URLs as printed' },
        },
      },
      summary: { type: 'string', description: 'The professional summary. If none exists, compose 1-2 sentences strictly from facts in the resume.' },
      skills: { type: 'array', items: { type: 'string' }, description: 'Distinct skills/tools, lowercase, deduplicated' },
      experience: {
        type: 'array',
        description: 'Roles in the order they appear',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['company', 'title', 'dates', 'bullets'],
          properties: {
            company: { type: 'string' },
            title: { type: 'string' },
            dates: { type: 'string', description: 'As printed, e.g. "2022 – present"' },
            bullets: { type: 'array', items: { type: 'string' }, description: 'Achievement bullets, wording preserved' },
          },
        },
      },
    },
  },
};

const SYSTEM = `You structure resumes for a private job-search tool.
Restructure faithfully: keep bullet wording essentially as written, keep every number and metric exactly, never add skills, employers, dates, or accomplishments that are not in the text.`;

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
    await requireUser(event);

    if (!process.env.ANTHROPIC_API_KEY) {
      return json(500, { error: 'RUNWAY_ENV_MISSING: ANTHROPIC_API_KEY — set it in Netlify env vars and redeploy' });
    }

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch { /* handled below */ }
    const text = String(body.text || '').trim().slice(0, 30000);
    if (text.length < 80) return json(400, { error: 'Paste the full resume text (that looks too short).' });

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: 3000,
      system: SYSTEM,
      tools: [resumeTool],
      tool_choice: { type: 'tool', name: 'record_resume' },
      messages: [{ role: 'user', content: `Structure this resume:\n\n${text}` }],
    });

    const toolUse = msg.content.find((b) => b.type === 'tool_use');
    if (!toolUse) return json(502, { error: 'Structuring produced no output — try again.' });

    return json(200, { resume: toolUse.input });
  } catch (ex) {
    return errorResponse(ex);
  }
};
