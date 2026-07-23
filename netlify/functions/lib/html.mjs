// Minimal HTML → text for job feeds; shared by parse-job and the board scanner.
export const decodeEntities = (s) =>
  s.replace(/&(?:amp|lt|gt|quot|#39|nbsp|#x27|#x2f);/gi, (m) => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&nbsp;': ' ', '&#x27;': "'", '&#x2f;': '/',
  }[m.toLowerCase()] || m));

export const stripHtml = (html) =>
  decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
