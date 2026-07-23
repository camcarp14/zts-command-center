// netlify/functions/check-replies.js
// Polls Gmail inbox for replies to sent outreach threads

const { requireAuth } = require("./_shared/requireAuth.cjs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const auth = await requireAuth(event);
  if (!auth.ok) return { statusCode: auth.status, body: JSON.stringify({ error: auth.error }) };

  const { sentThreadIds } = JSON.parse(event.body || "{}");
  if (!sentThreadIds || sentThreadIds.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ replies: [] }) };
  }

  try {
    // Get fresh access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    const { access_token } = await tokenRes.json();
    const replies = [];

    // Check each thread for new messages
    for (const threadId of sentThreadIds) {
      try {
        const threadRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From,Subject,Date`,
          { headers: { Authorization: `Bearer ${access_token}` } }
        );
        const thread = await threadRes.json();
        const messages = thread.messages || [];

        // If thread has more than 1 message, there's a reply
        if (messages.length > 1) {
          // Get the latest message (the reply)
          const latestMsg = messages[messages.length - 1];
          const headers = latestMsg.payload?.headers || [];
          const get = (name) => headers.find((h) => h.name === name)?.value || "";
          const from = get("From");

          // Only count as reply if it's NOT from us
          if (!from.includes("clarifypaidsearch@gmail.com")) {
            // Get full message body
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${latestMsg.id}?format=full`,
              { headers: { Authorization: `Bearer ${access_token}` } }
            );
            const msg = await msgRes.json();

            // Extract plain text body
            let body = "";
            const parts = msg.payload?.parts || [msg.payload];
            for (const part of parts) {
              if (part?.mimeType === "text/plain" && part?.body?.data) {
                body = Buffer.from(part.body.data, "base64").toString("utf-8");
                break;
              }
            }

            replies.push({
              threadId,
              messageId: latestMsg.id,
              from,
              subject: get("Subject"),
              date: get("Date"),
              body: body.slice(0, 2000),
              snippet: msg.snippet,
            });
          }
        }
      } catch {}
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replies }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
