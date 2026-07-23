// ─── Auth guard for the operator-only Netlify functions ─────────────────────
// send-email / check-replies / read-emails / claude / prospect-proxy do real
// work (send email as Cameron, spend Anthropic/Places/Hunter/Firecrawl credit)
// and previously ran for ANY caller who found the URL, logged in or not. This
// requires a valid Supabase session token — the same one the app already
// gets on login — instead of a new secret: it calls Supabase's own
// /auth/v1/user with the caller's token, using the PUBLIC anon key (already
// shipped in the client bundle). Zero new env vars, zero new secret surface.
//
//   const { requireAuth } = require("./_shared/requireAuth.cjs");
//   exports.handler = async (event) => {
//     if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
//     const auth = await requireAuth(event);
//     if (!auth.ok) return { statusCode: auth.status, body: JSON.stringify({ error: auth.error }) };
//     // ...existing handler logic, unchanged
//   };
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = require("./supabaseRest.cjs");

async function requireAuth(event) {
  const header = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "Sign in required — no session token on this request." };

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, status: 401, error: "Session expired or invalid — sign in again." };
    const user = await res.json();
    return { ok: true, user };
  } catch {
    return { ok: false, status: 401, error: "Couldn't verify session — try again." };
  }
}

module.exports = { requireAuth };
