// Publishes an approved article to the Shopify blog.
// Env vars required (set in Netlify → Site configuration → Environment variables):
//   SHOPIFY_STORE       — e.g. "zero-to-secure.myshopify.com"
//   SHOPIFY_ADMIN_TOKEN — Admin API access token (from a custom app with write_content scope)
//   SHOPIFY_BLOG_ID     — the numeric blog id (Shopify admin → Online Store → Blog posts → check URL, or GET /admin/api/2024-01/blogs.json)
// Optional:
//   SHOPIFY_PUBLIC_DOMAIN — the storefront's public domain (e.g. "zerotosecure.com") for the "View live" link

const { json, error, methodGuard } = require("./_shared/response");
const { requireUser } = require("./_shared/auth");

exports.handler = async (event) => {
  const guard = methodGuard(event, "POST");
  if (guard) return guard;

  // Publishing to the live blog is exactly the action the app's whole approval
  // spine protects — the public function URL must not be a way around it.
  const denied = await requireUser(event);
  if (denied) return denied;

  const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, SHOPIFY_BLOG_ID } = process.env;
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN || !SHOPIFY_BLOG_ID) {
    return error(500, "Missing SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN / SHOPIFY_BLOG_ID env vars");
  }

  try {
    const { title, body_html, summary, tags, handle } = JSON.parse(event.body || "{}");
    const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/blogs/${SHOPIFY_BLOG_ID}/articles.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN },
      body: JSON.stringify({
        article: {
          title,
          body_html,
          summary_html: summary || "",
          tags: tags || "",
          handle: handle || undefined,
          published: true,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.article) {
      return error(502, JSON.stringify(data.errors || data));
    }
    // Public URL: prefer an explicit SHOPIFY_PUBLIC_DOMAIN (e.g. "zerotosecure.com");
    // the old guess of "<store>.com" only works when the custom domain happens to
    // match the myshopify subdomain.
    const domain = process.env.SHOPIFY_PUBLIC_DOMAIN || `${SHOPIFY_STORE.replace(".myshopify.com", "")}.com`;
    const url = `https://${domain}/blogs/news/${data.article.handle}`;
    return json(200, { success: true, id: data.article.id, handle: data.article.handle, url });
  } catch (e) {
    return error(500, e.message);
  }
};
