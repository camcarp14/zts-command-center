// ─── Shared Netlify function auth guard ─────────────────────────────────────
// Both functions here spend real money (Anthropic tokens) or publish to the
// live Shopify blog, and Netlify function URLs are public — without a check,
// anyone who finds /.netlify/functions/claude can burn the API key.
//
// The guard verifies the caller's Supabase session token (the app sends it as
// an Authorization: Bearer header once signed in) against Supabase's own
// /auth/v1/user endpoint. No new secrets: it reuses the same URL + anon key
// the client build already uses, which Netlify exposes to functions too.
//
// Fails OPEN only when Supabase isn't configured at all — the same
// zero-config grace the rest of the app extends (an unconfigured install has
// no users to verify and nothing worth abusing behind it yet).

const { error } = require("./response");

async function requireUser(event) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null; // unconfigured install — skip the check

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return error(401, "Sign in required");

  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return error(401, "Session invalid or expired — sign in again");
    return null;
  } catch (e) {
    return error(502, "Couldn't verify the session: " + e.message);
  }
}

module.exports = { requireUser };
