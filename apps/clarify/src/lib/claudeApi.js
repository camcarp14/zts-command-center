import { ANTHROPIC_API_KEY } from "../config.js";
import { obs } from "./store.js";
import { functionAuthHeaders } from "./supabase.js";

// ─── Observability — every Claude call in this system logs here ──────────────
// No backend yet, so this lives client-side. Once Langfuse or similar is wired
// to a deployed agent backend, this same log shape carries over directly.
export const MODEL_PRICING = {
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },   // $ per million tokens, approximate
  "claude-sonnet-4-6": { in: 3, out: 15 },           // $ per million tokens, approximate
};

export function estimateCost(model, inputTokens = 0, outputTokens = 0) {
  const p = MODEL_PRICING[model] || MODEL_PRICING["claude-sonnet-4-6"];
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}

// ─── callClaude — the ONE seam every Claude request flows through ────────────
// Deployed traffic always rides the Netlify proxy (server-side key); the raw
// VITE_ANTHROPIC_API_KEY is only ever touched on localhost. Routing, headers,
// and observability logging live here and nowhere else. Returns { ok, data,
// text, error } and never throws — call sites keep their own parsing/fallbacks.
export async function callClaude({ model, max_tokens, system, messages, fn, promptChars = 0 }) {
  const deployed = window.location.hostname !== "localhost";
  const url = deployed ? "/.netlify/functions/claude" : "https://api.anthropic.com/v1/messages";
  const headers = deployed
    ? { "Content-Type": "application/json", ...functionAuthHeaders() }
    : {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        ...(Array.isArray(system) ? { "anthropic-beta": "prompt-caching-2024-07-31" } : {}),
        "anthropic-dangerous-direct-browser-access": "true",
      };
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST", headers,
      body: JSON.stringify({ model, max_tokens, ...(system ? { system } : {}), messages }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || null;
    const inTok = data.usage?.input_tokens || Math.round(promptChars / 4);
    const outTok = data.usage?.output_tokens || (text ? Math.round(text.length / 4) : 0);
    obs.log({ fn, model, inputTokens: inTok, outputTokens: outTok, costEstimate: estimateCost(model, inTok, outTok), latencyMs: Date.now() - t0, ok: res.ok && !!text });
    return { ok: res.ok, data, text, error: res.ok ? null : (data.error?.message || "API error") };
  } catch (e) {
    obs.log({ fn, model, ok: false, latencyMs: Date.now() - t0 });
    return { ok: false, data: null, text: null, error: e.message || "Network error" };
  }
}
