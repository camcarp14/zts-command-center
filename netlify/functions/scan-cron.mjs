// scan-cron — scheduled weekday-morning scan (see netlify.toml). Runs
// headless, so it needs SUPABASE_SERVICE_ROLE_KEY (functions scope only —
// never VITE_-prefixed). Until that key is set this endpoint is a loud no-op
// returning a named error; add the key and the schedule just starts working.
// Writes are pinned to the single allow-listed user; worst case for an
// unauthenticated manual invocation is an extra scan of public feeds.
import { createClient } from '@supabase/supabase-js';
import { json, errorResponse, env } from './lib/auth.mjs';
import { scanBoards } from './lib/scan-core.mjs';

export const handler = async () => {
  try {
    const [url] = env('VITE_SUPABASE_URL');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const allowed = process.env.ALLOWED_EMAIL;
    if (!serviceKey || !allowed) {
      const missing = [!serviceKey && 'SUPABASE_SERVICE_ROLE_KEY', !allowed && 'ALLOWED_EMAIL'].filter(Boolean);
      return json(500, { error: `RUNWAY_ENV_MISSING: ${missing.join(', ')} — scheduled scans stay off until set` });
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false }, db: { schema: 'runway' } });
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 10 });
    if (error) return json(500, { error: `user lookup failed: ${error.message}` });
    const user = (data?.users || []).find((u) => String(u.email).toLowerCase() === allowed.toLowerCase());
    if (!user) return json(500, { error: 'allow-listed user not found' });

    const summary = await scanBoards({ db: admin, userId: user.id });
    console.log('scan-cron summary', JSON.stringify(summary));
    return json(200, summary);
  } catch (ex) {
    return errorResponse(ex);
  }
};
