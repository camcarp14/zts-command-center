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

// Runway's tables live in the "runway" schema of the shared board-room
// Supabase project (consolidated 2026-07); auth stays on the default schema.
export const supabase = createClient(url, anon, { db: { schema: 'runway' } });
