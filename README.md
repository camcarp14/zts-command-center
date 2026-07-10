# ZTS Command Center

Zero To Secure's operations tool — three pillars, one app:

| Tab | What lives there |
|---|---|
| **Mission** | Today's picture: creator pipeline, Studio status, AI spend, agent roster |
| **Creators** | YouTube-creator collab pipeline, auto-scored by niche fit — with AI collab-pitch drafting |
| **Studio** | Shorts ideation (Claude drafts the full asset package) + the Factory production rail |
| **SEO** | Article pipeline with an approval gate; publishes to the Shopify blog |
| **Agents** | The heuristic agent engine — free heartbeat, gated synthesis |
| **Ops** | Every Claude call: tokens, cost, latency, success |

Every pipeline moves both directions (`‹ ›` on cards), and `⌘K` opens a command
palette from anywhere — jump to tabs, creators, Shorts, articles, or quick-create.

## The Factory (shorts-factory)

`factory/` holds the production half of the Studio: a local Python pipeline that
turns raw filmed footage into a finished 9:16 Short — local whisper transcription,
LLM clip selection, dead-air tightening, face-aware crop, word-highlight captions,
restrained pop-ups, and a mandatory review gate before export. See
[factory/README.md](factory/README.md) for setup (Python 3.10+, ffmpeg; Windows
runs it under WSL2).

The two halves connect through a zero-dependency local bridge:

```bash
cd factory && python bridge.py     # http://127.0.0.1:8765
```

With the bridge running, the Studio tab's Factory rail shows live project state,
renders each draft's REVIEW doc in-app, and can approve drafts. "⇢ Factory" on
any scripted Short delivers a production brief into `factory/briefs/` — film it,
run the CLI, and the project appears in the rail. With the bridge offline
(including on the deployed site), the same handoff copies a complete brief to
the clipboard instead. The bridge binds 127.0.0.1 only, is read-only apart from
draft approval and brief drop-off, and never runs renders or spends API money.

## Stack

- Vite + React 18, single-page; design tokens + shared primitives in `src/ui.jsx`
- Supabase (`creators` / `shorts` / `articles` tables + auth); every write has a
  local fallback so the app still functions without configuration
- Netlify Functions: `claude` (Anthropic proxy), `shopify-publish` (blog posts)
- shorts-factory: Python 3.10+ / ffmpeg / faster-whisper, `factory/`

## Environment

**Netlify (server-side):** `ANTHROPIC_API_KEY`, `SHOPIFY_*` (see
`netlify/functions/shopify-publish.js`).

**Client (safe to expose):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` —
RLS protects the data, not key secrecy. Local dev also reads
`VITE_ANTHROPIC_API_KEY` for direct API calls on localhost only.

## Notes

- `factory/projects/` and `factory/briefs/` are gitignored — footage and renders
  stay on the machine that filmed them.
- The SEO auto-draft cadence and agent-engine synthesis are both opt-in and
  cost-capped; a fresh install spends $0 until you flip them on.
