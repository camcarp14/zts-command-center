// ═══════════════════════════════════════════════════════════════════════════
// @cc/supabase — one client, one login, schema-scoped data access.
//
// After the 2026-07 consolidation, ALL three tools live in a single Supabase
// project (the former "clarify-outreach" project):
//     • Clarify  → public schema
//     • ZTS      → zts schema
//     • Runway   → runway schema
//     • auth     → shared (one user, one session, one login)
//
// Because it's one project, we use ONE supabase-js client for auth + the public
// schema, and `.schema('zts' | 'runway')` for the other two — no second GoTrue
// instance, no double login. A tool asks for its data via zts()/runway()/
// clarify() and never has to know the project wiring.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[@cc/supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — " +
    "database and auth calls will fail until these are set in .env (local) or the deploy's env vars."
  );
}

// One client. Default schema is public (Clarify + auth). RLS — not key secrecy —
// protects the data; the anon/publishable key is public by design.
export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

// ─── Schema-scoped query entrypoints ─────────────────────────────────────────
// Each returns a PostgREST builder bound to that schema, sharing the one auth
// session. The schema must be exposed in the project's API settings + granted
// (public/zts/runway all are).
export const clarify = () => supabase;                       // public schema
export const zts = () => supabase?.schema("zts");
export const runway = () => supabase?.schema("runway");
export const schema = (name) => (name && name !== "public" ? supabase?.schema(name) : supabase);

// ─── One login ───────────────────────────────────────────────────────────────
export const auth = {
  async signIn(email, password) {
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  async signOut() {
    await supabase?.auth.signOut();
  },
  async getSession() {
    const { data } = (await supabase?.auth.getSession()) || { data: { session: null } };
    return data.session;
  },
  async getUser() {
    const { data } = (await supabase?.auth.getUser()) || { data: { user: null } };
    return data.user;
  },
  // Subscribe to session changes; returns an unsubscribe fn.
  onChange(cb) {
    const { data } = supabase?.auth.onAuthStateChange((_e, session) => cb(session)) || { data: null };
    return () => data?.subscription?.unsubscribe();
  },
};

export const isConfigured = () => !!supabase;
