// scan-boards — on-demand watchlist scan, authenticated as the caller (RLS
// applies to every read/write). Triggered by the app on open (when stale) and
// by the "Scan now" button.
import { requireUser, json, errorResponse } from './lib/auth.mjs';
import { scanBoards } from './lib/scan-core.mjs';

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
    const { user, supa } = await requireUser(event);
    const summary = await scanBoards({ db: supa, userId: user.id });
    return json(200, summary);
  } catch (ex) {
    return errorResponse(ex);
  }
};
