import { createClient } from '@supabase/supabase-js';

// Loud env guard: a missing var throws a NAMED error at boot (painted by
// index.html's error handler). "Not signed in" must never be the symptom of
// a misconfigured environment.
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
const missing = [!url && 'VITE_SUPABASE_URL', !anon && 'VITE_SUPABASE_ANON_KEY'].filter(Boolean);
if (missing.length) {
  throw new Error(`RUNWAY_ENV_MISSING: ${missing.join(', ')}`);
}

// Runway's tables live in the "runway" schema of the shared Pentagon Supabase
// project (consolidated 2026-07); auth stays on the default schema.
//
// autoRefreshToken:false is deliberate: under the shell, three tool clients
// share one session (same storage key). If each auto-refreshed they'd race on the
// single refresh token ("token already used" → random sign-outs). The shell owns
// refresh; persistSession keeps this client reading the shared, synced session.
export const supabase = createClient(url, anon, { db: { schema: 'runway' }, auth: { persistSession: true, autoRefreshToken: false } });
