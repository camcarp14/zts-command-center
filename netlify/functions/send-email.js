// netlify/functions/send-email.js
// Sends email via Gmail API using OAuth2
// Requires GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN env vars

const { requireAuth } = require("./_shared/requireAuth.cjs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  // This sends real email as Cameron — require a signed-in caller.
  const auth = await requireAuth(event);
  if (!auth.ok) return { statusCode: auth.status, body: JSON.stringify({ error: auth.error }) };

  const { to, subject, body, replyToMessageId, threadId } = JSON.parse(event.body);

  if (!to || !subject || !body) {
    return { statusCode: 400, body: "Missing required fields: to, subject, body" };
  }

  try {
    // 1. Get fresh access token from refresh token
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

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error("Failed to get access token: " + JSON.stringify(tokenData));
    }

    // 2. Build RFC 2822 email
    const from = "Cameron | Clarify Paid Search <clarifypaidsearch@gmail.com>";
    const encodedSubject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const emailLines = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ];

    if (replyToMessageId) {
      emailLines.splice(3, 0, `In-Reply-To: ${replyToMessageId}`, `References: ${replyToMessageId}`);
    }

    const rawEmail = emailLines.join("\r\n");
    const encodedEmail = Buffer.from(rawEmail).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    // 3. Send via Gmail API
    // Include threadId when replying to keep Gmail threading
    const sendPayload = { raw: encodedEmail };
    if (threadId) sendPayload.threadId = threadId;

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sendPayload),
    });

    const sendData = await sendRes.json();

    if (!sendRes.ok) {
      throw new Error("Gmail send failed: " + JSON.stringify(sendData));
    }

    // Fetch the RFC 2822 Message-ID from the sent message (needed for In-Reply-To on replies)
    let rfcMessageId = null;
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${sendData.id}?format=metadata&metadataHeaders=Message-ID`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      const msgData = await msgRes.json();
      rfcMessageId = msgData.payload?.headers?.find(h => h.name === "Message-ID")?.value || null;
    } catch {}

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        messageId: sendData.id,
        threadId: sendData.threadId,
        rfcMessageId,
      }),
    };
  } catch (err) {
    console.error("Send email error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
