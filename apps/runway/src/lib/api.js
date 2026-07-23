// Authenticated calls to our own Netlify functions. The Anthropic key never
// touches the client — these endpoints hold it server-side.
import { supabase } from './supabase.js';

export async function apiPost(path, body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  let json = {};
  try { json = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    throw new Error(json.error || `Request failed (HTTP ${res.status})`);
  }
  return json;
}
