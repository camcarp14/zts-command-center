// netlify/functions/claude.js
// Proxy for Anthropic API calls — keeps the key server-side.
// Same pattern as clarify-outreach and board-room's claude.js functions.
//
// This function did not exist before — every AI-powered feature in this app
// (Studio's Short generation, SEO auto-draft, the Agents engine) calls
// /.netlify/functions/claude via callClaude() in App.jsx, and has been
// getting a 404 on every deployed request. Local dev worked around this by
// calling Anthropic directly from the browser with VITE_ANTHROPIC_API_KEY,
// which is why this gap wasn't obvious — it only breaks once deployed.

const { json, error, methodGuard } = require("./_shared/response");

exports.handler = async (event) => {
  const guard = methodGuard(event, "POST");
  if (guard) return guard;

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    return error(500, "Missing ANTHROPIC_API_KEY in Netlify env vars");
  }

  try {
    const body = JSON.parse(event.body || "{}");
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
