// env-check — deployment self-diagnosis endpoint, deployed on day one.
// Safe to leave up: returns booleans, hostnames, and role claims — never key
// material. `commit` answers "which build is actually live?" directly
// (stamped at build time by scripts/stamp-build.mjs).
import buildInfo from './lib/build-info.json';

const host = (u) => { try { return new URL(u).host; } catch { return null; } };
const jwtRole = (k) => {
  try { return JSON.parse(Buffer.from(String(k).split('.')[1], 'base64url').toString('utf8')).role || null; }
  catch { return null; }
};

export const handler = async () => {
  const SUPA_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPA_ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const out = {
    context: buildInfo.context || process.env.CONTEXT || null,
    commit: buildInfo.commit || (process.env.COMMIT_REF ? String(process.env.COMMIT_REF).slice(0, 7) : null),
    built_at: buildInfo.built_at,
    supabase_url_host: host(SUPA_URL),
    anon_key_present: !!SUPA_ANON,
    anon_key_role: jwtRole(SUPA_ANON), // expect 'anon'
    anthropic_key_present: !!process.env.ANTHROPIC_API_KEY,
    allowed_email_present: !!process.env.ALLOWED_EMAIL,
    // optional: powers scheduled scans only. The role decode catches the
    // silent killer — an anon key pasted into the service slot.
    service_key_present: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    service_key_role: jwtRole(process.env.SUPABASE_SERVICE_ROLE_KEY), // must be 'service_role'
    service_slot_holds_anon_key: jwtRole(process.env.SUPABASE_SERVICE_ROLE_KEY) === 'anon',
    missing: [
      !SUPA_URL && 'VITE_SUPABASE_URL',
      !SUPA_ANON && 'VITE_SUPABASE_ANON_KEY',
      !process.env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY',
      !process.env.ALLOWED_EMAIL && 'ALLOWED_EMAIL',
    ].filter(Boolean),
  };
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) };
};
