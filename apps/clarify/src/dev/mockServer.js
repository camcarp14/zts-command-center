// ─── Dev-only mock server — VITE_MOCK=1 npm run dev ──────────────────────────
// Installs a fetch interceptor that answers Supabase REST/Auth and Netlify
// function calls from in-memory fixtures, so every view can be driven (and
// screenshot-tested) deterministically with zero network and zero risk to the
// live database. Never bundled in production: main.jsx only imports this file
// inside `if (import.meta.env.DEV && import.meta.env.VITE_MOCK === "1")`.
import { makeFixtures } from "./mockData";

const enc = (o) => JSON.stringify(o);
const ok = (data, status = 200) =>
  new Response(typeof data === "string" ? data : enc(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Minimal PostgREST query semantics — exactly what this app uses:
//   ?select=*,prospect:prospects(*),contact:contacts(*)   (embedding)
//   ?col=eq.value        ?order=col.desc        ?limit=N       ?status=eq.new
function parseQuery(qs) {
  const params = new URLSearchParams(qs);
  const filters = [];
  let order = null, limit = null, select = "*";
  for (const [k, v] of params.entries()) {
    if (k === "select") select = v;
    else if (k === "order") order = v;
    else if (k === "limit") limit = Number(v);
    else if (v.startsWith("eq.")) filters.push({ col: k, val: v.slice(3) });
    else if (v.startsWith("in.")) filters.push({ col: k, val: v.slice(4, -1).split(","), op: "in" });
  }
  return { filters, order, limit, select };
}

function applyQuery(rows, q, db) {
  let out = rows.filter((r) =>
    q.filters.every((f) => (f.op === "in" ? f.val.includes(String(r[f.col])) : String(r[f.col]) === f.val))
  );
  if (q.order) {
    const [col, dir] = q.order.split(".");
    out = [...out].sort((a, b) => {
      const av = a[col] ?? "", bv = b[col] ?? "";
      return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === "desc" ? -1 : 1);
    });
  }
  // Embeddings used by the app: prospect:prospects(*), contact:contacts(*),
  // and the queue's nested outreach:outreach(*,prospect(*),contact(*)).
  if (q.select.includes("outreach:outreach")) {
    out = out.map((r) => {
      const o = db.outreach.find((x) => x.id === r.outreach_id) || null;
      return {
        ...r,
        outreach: o && {
          ...o,
          prospect: db.prospects.find((p) => p.id === o.prospect_id) || null,
          contact: db.contacts.find((c) => c.id === o.contact_id) || null,
        },
      };
    });
  }
  if (q.select.includes("prospect:prospects")) {
    out = out.map((r) => ({ ...r, prospect: db.prospects.find((p) => p.id === r.prospect_id) || null }));
  }
  if (q.select.includes("contact:contacts")) {
    out = out.map((r) => ({ ...r, contact: db.contacts.find((c) => c.id === r.contact_id) || null }));
  }
  if (q.limit) out = out.slice(0, q.limit);
  return out;
}

export function install() {
  const db = makeFixtures();
  const realFetch = window.fetch.bind(window);
  let idCounter = 1000;
  const newId = () => `mock-${idCounter++}`;

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();

    // ── Supabase Auth ────────────────────────────────────────────────────────
    if (url.includes("/auth/v1/")) {
      if (url.includes("grant_type=password") || url.includes("grant_type=refresh_token")) {
        return ok({ access_token: "mock-token", refresh_token: "mock-refresh", user: { id: "mock-user", email: "cam@mock.dev" } });
      }
      if (url.includes("/auth/v1/user")) return ok({ id: "mock-user", email: "cam@mock.dev" });
      if (url.includes("/auth/v1/logout")) return ok({});
      return ok({});
    }

    // ── Supabase REST ────────────────────────────────────────────────────────
    const rest = url.match(/\/rest\/v1\/([a-z_]+)(\?(.*))?$/);
    if (rest) {
      const table = rest[1];
      const q = parseQuery(rest[3] || "");
      if (!db[table]) db[table] = [];
      if (method === "GET") return ok(applyQuery(db[table], q, db));
      if (method === "POST") {
        const body = JSON.parse(init.body || "{}");
        const rows = (Array.isArray(body) ? body : [body]).map((r) => ({
          id: newId(), created_at: new Date().toISOString(), ...r,
        }));
        // PostgREST upsert: ?on_conflict=col + Prefer resolution=merge-duplicates
        // must MERGE, not append — otherwise Settings saves look successful in
        // mock mode but reads keep returning the first-ever row.
        const conflictCol = new URLSearchParams(rest[3] || "").get("on_conflict");
        if (conflictCol) {
          for (const r of rows) {
            const i = db[table].findIndex((x) => x[conflictCol] === r[conflictCol]);
            if (i >= 0) db[table][i] = { ...db[table][i], ...r };
            else db[table].push(r);
          }
          return ok(rows, 201);
        }
        db[table].push(...rows);
        return ok(rows, 201);
      }
      if (method === "PATCH") {
        const body = JSON.parse(init.body || "{}");
        const hit = applyQuery(db[table], { ...q, order: null, limit: null, select: "*" }, db);
        hit.forEach((row) => Object.assign(db[table].find((r) => r.id === row.id), body));
        return ok(hit);
      }
      if (method === "DELETE") {
        const hit = applyQuery(db[table], { ...q, order: null, limit: null, select: "*" }, db);
        const ids = new Set(hit.map((r) => r.id));
        db[table] = db[table].filter((r) => !ids.has(r.id));
        return ok(hit);
      }
    }

    // ── Netlify functions ────────────────────────────────────────────────────
    if (url.includes("/.netlify/functions/claude")) {
      // Deterministic canned "AI": echoes a plausible JSON payload per fn hints.
      return ok({
        id: "mock-msg", model: "mock", usage: { input_tokens: 200, output_tokens: 120 },
        content: [{ type: "text", text: enc({ subject: "Quick idea for your Google Ads", body: "Hi — noticed a gap in your paid search coverage. Worth a quick chat?\n\nCameron | Clarify Paid Search" }) }],
      });
    }
    if (url.includes("/.netlify/functions/send-email")) {
      return ok({ success: true, messageId: `mock-gm-${Date.now()}`, threadId: `mock-th-${Date.now()}`, rfcMessageId: `<mock-${Date.now()}@mail.gmail.com>` });
    }
    if (url.includes("/.netlify/functions/check-replies")) return ok({ replies: [] });
    if (url.includes("/.netlify/functions/prospect-proxy")) return ok({ places: [] });
    if (url.includes("/.netlify/functions/audit-lead")) {
      return ok({
        url: "https://example.com", finalUrl: "https://example.com", score: 62,
        checks: [
          { key: "reachable", label: "Site loads", status: "pass", detail: "Responded in 412ms" },
          { key: "https", label: "Secure (HTTPS)", status: "pass", detail: "Serving over HTTPS" },
          { key: "analytics", label: "Google Analytics / Tag Manager", status: "fail", detail: "No analytics tag found — you can't optimize what you don't measure" },
          { key: "ads_tag", label: "Google Ads conversion tag", status: "warn", detail: "No Ads conversion tag — if you're running ads, conversions aren't tracked" },
          { key: "viewport", label: "Mobile-ready viewport", status: "pass", detail: "Responsive viewport configured" },
          { key: "phone", label: "Click-to-call", status: "warn", detail: "No visible phone number — local intent converts on calls" },
        ],
        insights: { insights: ["Every ad click lands untracked — you're optimizing blind.", "No conversion tag means Google's bidding can't learn what a good visitor looks like.", "Mobile visitors can call you only if the number is tappable."], priority: "Install GA4 + the Ads conversion tag first — everything else compounds on measurement." },
        ran_at: new Date().toISOString(),
      });
    }
    if (url.includes("/.netlify/functions/")) return ok({});

    return realFetch(input, init);
  };

  // Pre-seed the session so screenshots land past the login screen.
  localStorage.setItem("clarify_token", "mock-token");
  localStorage.setItem("clarify_refresh", "mock-refresh");
  console.info("[mock] Clarify mock server installed — no real network calls will be made.");
}
