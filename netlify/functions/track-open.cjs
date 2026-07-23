// ─── Open tracking pixel — GET /px/<message-uuid>.gif ────────────────────────
// Records an open event and returns a 1x1 transparent gif. Dormant until sends
// go HTML (plain-text emails can't embed a pixel — see PLAN.md AD-4), but
// shipped complete so flipping OPEN_TRACKING_LIVE is the only change needed.
// email_events is anon INSERT-only; the message uuid is unguessable.
const { sbRest, UUID_RE } = require("./_shared/supabaseRest.cjs");

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

exports.handler = async (event) => {
  const last = (event.path || "").split("/").filter(Boolean).pop() || "";
  const id = last.replace(/\.gif$/i, "");
  if (UUID_RE.test(id)) {
    try {
      await sbRest(`/email_events`, {
        method: "POST",
        prefer: "return=minimal",
        body: {
          message_id: id,
          event_type: "open",
          user_agent: (event.headers && (event.headers["user-agent"] || event.headers["User-Agent"])) || null,
        },
      });
    } catch {
      // best-effort — always return the pixel
    }
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" },
    body: GIF.toString("base64"),
    isBase64Encoded: true,
  };
};
