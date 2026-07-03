// Publishes an approved article to the Shopify blog.
// Env vars required (set in Netlify → Site configuration → Environment variables):
//   SHOPIFY_STORE      — e.g. "zero-to-secure.myshopify.com"
//   SHOPIFY_ADMIN_TOKEN — Admin API access token (from a custom app with write_content scope)
//   SHOPIFY_BLOG_ID    — the numeric blog id (Shopify admin → Online Store → Blog posts → check URL, or GET /admin/api/2024-01/blogs.json)

export default async (req) => {
  if (req.method !== "POST") return Response.json({ success: false, error: "POST only" }, { status: 405 });
  const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, SHOPIFY_BLOG_ID } = process.env;
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN || !SHOPIFY_BLOG_ID) {
    return Response.json({ success: false, error: "Missing SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN / SHOPIFY_BLOG_ID env vars" }, { status: 500 });
  }
  try {
    const { title, body_html, summary, tags, handle } = await req.json();
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
      return Response.json({ success: false, error: JSON.stringify(data.errors || data) }, { status: 502 });
    }
    const url = `https://${SHOPIFY_STORE.replace(".myshopify.com", "")}.com/blogs/news/${data.article.handle}`;
    return Response.json({ success: true, id: data.article.id, handle: data.article.handle, url });
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
};
