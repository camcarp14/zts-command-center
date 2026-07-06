// ─── Shared Supabase client pattern ────────────────────────────────────────
// Board Room already does this correctly — this file formalizes that pattern
// so ZTS and Clarify Outreach use the same approach instead of each inventing
// their own.
//
// Drop this file in as src/supabaseClient.js, then:
//   import { supabase } from "./supabaseClient";
//   const { data, error } = await supabase.from("table_name").select();
//
// Requires @supabase/supabase-js in package.json:
//   npm install @supabase/supabase-js
//
// Requires these in your Netlify env vars AND local .env (VITE_ prefix is
// required and safe here — anon/publishable keys are meant to be public;
// Row Level Security, not secrecy, is what protects your data):
//   VITE_SUPABASE_URL=https://your-project.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
//
// What this replaces in Clarify Outreach specifically: hand-rolled fetch()
// calls to /rest/v1 and /auth/v1 with a hardcoded URL and key. Same Supabase
// project, same permissions — just the maintained SDK instead of a
// hand-built REST client, so you get real-time subscriptions, auth session
// handling, and typed query building for free. Migrating the existing call
// sites over is rollout work for the Clarify Outreach phase, not this file.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[supabaseClient] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — " +
    "database calls will fail until these are set in .env (local) or Netlify env vars (deployed)."
  );
}

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
