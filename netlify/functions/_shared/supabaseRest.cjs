// ─── Minimal PostgREST client for Netlify functions ─────────────────────────
// Uses the project's PUBLIC url + publishable key — the same values shipped in
// the client bundle, so this adds no secret surface (AD-1 in PLAN.md: this
// build introduces zero new env vars). What these functions may touch is
// governed entirely by RLS: email_events is anon INSERT-only, tracked_links is
// anon SELECT by unguessable uuid, inbound_leads/audit_requests anon INSERT.
const SUPABASE_URL = "https://nrzpinvyxxorxufadvyc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_zDV3HpSChf0bZJ5nY09s3w_rNI3sZ1m";

async function sbRest(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PostgREST ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = { sbRest, UUID_RE, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY };
