// Tiny markdown parser for AI-drafted content (headings, lists, bold/italic,
// hr, paragraphs). Returns a block tree — the renderer maps it to React
// elements, so model output is never injected as HTML. Pure + smoke-tested.

// inline: **bold**, *italic*, plain — returns [{ t: 'text'|'b'|'i', s }]
export function parseInline(s) {
  const out = [];
  let rest = String(s ?? '');
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/;
  while (rest) {
    const m = rest.match(re);
    if (!m) { out.push({ t: 'text', s: rest }); break; }
    if (m.index > 0) out.push({ t: 'text', s: rest.slice(0, m.index) });
    if (m[2] != null) out.push({ t: 'b', s: m[2] });
    else out.push({ t: 'i', s: m[3] });
    rest = rest.slice(m.index + m[1].length);
  }
  return out;
}

// blocks: [{ type: 'h1'|'h2'|'h3'|'ul'|'hr'|'p', text?, items? }]
export function parseMarkdown(text) {
  const blocks = [];
  let list = null;
  const flushList = () => { if (list) { blocks.push({ type: 'ul', items: list }); list = null; } };

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) { flushList(); continue; }
    if (/^(---|\*\*\*|___)$/.test(t)) { flushList(); blocks.push({ type: 'hr' }); continue; }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushList(); blocks.push({ type: `h${h[1].length}`, text: h[2] }); continue; }
    const li = t.match(/^[-•*]\s+(.*)$/);
    if (li) { (list = list || []).push(li[1]); continue; }
    flushList();
    blocks.push({ type: 'p', text: t });
  }
  flushList();
  return blocks;
}
