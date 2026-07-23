// netlify/functions/prospect-proxy.js
// One proxy for every third-party prospecting API. Keys live ONLY in server-side
// env vars (no VITE_ prefix — VITE_* vars get compiled into the public bundle).
//
// Required env vars on Netlify:
//   GOOGLE_PLACES_KEY, HUNTER_API_KEY, FIRECRAWL_API_KEY
// (VITE_-prefixed fallbacks are read for transition only — rename and rotate.)

const { requireAuth } = require("./_shared/requireAuth.cjs");

const key = (name) => process.env[name] || process.env[`VITE_${name}`] || "";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const auth = await requireAuth(event);
  if (!auth.ok) return { statusCode: auth.status, body: JSON.stringify({ error: auth.error }) };

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { service } = payload;
  try {
    let res;

    if (service === "places_search") {
      res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key("GOOGLE_PLACES_KEY"),
          "X-Goog-FieldMask": payload.fieldMask ||
            "places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.id",
        },
        body: JSON.stringify(payload.body || {}),
      });
    } else if (service === "hunter_domain_search") {
      const domain = encodeURIComponent(payload.domain || "");
      const limit = Number(payload.limit) || 1;
      res = await fetch(
        `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${key("HUNTER_API_KEY")}&limit=${limit}`
      );
    } else if (service === "firecrawl_scrape" || service === "firecrawl_batch_scrape") {
      const path = service === "firecrawl_scrape" ? "/v1/scrape" : "/v1/batch/scrape";
      res = await fetch(`https://api.firecrawl.dev${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key("FIRECRAWL_API_KEY")}`,
        },
        body: JSON.stringify(payload.body || {}),
      });
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown service: ${service}` }) };
    }

    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { "Content-Type": "application/json" },
      body: text,
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
