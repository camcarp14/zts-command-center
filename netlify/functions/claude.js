// netlify/functions/claude.js
// Proxy for Anthropic API calls — keeps the key server-side.
// Same pattern as clarify-outreach and board-room's claude.js functions.
//
// Guarded three ways, because this endpoint spends real money on a public URL:
//   1. requireUser — a valid Supabase session token (skipped only when
//      Supabase isn't configured at all; see _shared/auth.js).
//   2. Model allowlist — only the models the app actually uses. Add here AND
//      in the client's MODEL_PRICING when adopting a new one.
//   3. max_tokens ceiling — a stray or malicious 100k-token request is clamped.

const { json, error, methodGuard } = require("./_shared/response");
const { requireUser } = require("./_shared/auth");

const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
]);
const MAX_TOKENS_CEILING = 8192;

exports.handler = async (event) => {
  const guard = methodGuard(event, "POST");
  if (guard) return guard;

  const denied = await requireUser(event);
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    return error(500, "Missing ANTHROPIC_API_KEY in Netlify env vars");
  }

  try {
    const body = JSON.parse(event.body || "{}");
    if (!ALLOWED_MODELS.has(body.model)) {
      return error(400, `Model not allowed: ${body.model || "(none)"}`);
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return error(400, "messages must be a non-empty array");
    }
    body.max_tokens = Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CEILING);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return json(res.status, data);
  } catch (err) {
    return error(500, err.message);
  }
};
