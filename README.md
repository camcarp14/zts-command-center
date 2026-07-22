# ZTS Command Center

Zero To Secure's operations tool — three pillars, one app:

| Tab | What lives there |
|---|---|
| **Mission** | Today's picture: creator pipeline, Studio status, AI spend, agent roster |
| **Creators** | YouTube-creator collab pipeline, auto-scored by niche fit — with AI collab-pitch drafting |
| **Studio** | Shorts ideation (Claude drafts the full asset package) + the Factory production rail + Voicebox cloned-voice voiceovers |
| **SEO** | Article pipeline with an approval gate; publishes to the Shopify blog |
| **DNA** | The living mind: a weighted node graph that compiles into the worker's prompt |
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

## Voicebox — the voice half of the Studio

[Voicebox](https://github.com/jamiepine/voicebox) (MIT, local-first) is a
desktop voice studio: clone a voice from a minute of reference audio, then
generate speech on your own hardware — no cloud, no per-character bill. The
Command Center treats it exactly like the Factory bridge: a local companion
that lights up when it's running and costs nothing when it isn't.

With the Voicebox app open (`127.0.0.1:17493`):

- Every scripted Short grows a **Voiceover** asset in its detail panel — pick
  a cloned voice, hit generate, watch live progress, play the take in-app, and
  download the audio file for the edit. Regeneration and take-removal live in
  the same block, and Ops logs each generation at $0.00.
- The Studio's **Voicebox — voice lab** rail shows the app's status, your
  voice profiles (engine, language, take counts), and voiceover coverage
  across scripted Shorts.
- Editing a script after recording flags the take as **stale** (script-hash
  mismatch) on both the asset block and the kanban card's 🎙 marker, and the
  Production Watcher mentions voiceover gaps — but only on machines where
  Voicebox has actually been seen running.
- **⇢ Factory** briefs note an existing voiceover (voice, engine, duration) so
  the production side knows the VO is already recorded.

With Voicebox closed or never installed, all of this degrades to quiet
explainers — nothing errors, nothing nags.

Two practical notes:

- **Local dev works with zero config**: Voicebox's CORS allowlist already
  includes Vite's `http://localhost:5173`. For the **deployed** site to reach
  a local Voicebox, launch Voicebox with
  `VOICEBOX_CORS_ORIGINS=https://your-site.netlify.app` set.
- Voiceover metadata lives in `localStorage` (`zts_vo_*`), **not** Supabase —
  the audio itself only exists in Voicebox's database on the machine that
  generated it, so syncing pointers elsewhere would only create dead
  references. Same philosophy as `factory/projects/` staying gitignored.

## ZTS DNA

The **DNA** tab is the marketing machine's mind made visible and editable. It is a
living neural graph — **nodes** are aspects of how ZTS thinks (its identity, the
locked principles, what it knows, the signals it watches, the skills it can run,
the goals it drives toward), wired together by weighted **synapses** (excitatory
or tempering). Drag the canvas to explore it, double-click to grow a node,
⇧-drag to wire one, and click any node or synapse to tune its weight, directive,
region, or — for a skill — the model and token ceiling it runs on.

**The graph *is* the prompt.** `compileGenome()` turns the node graph
deterministically into a single system prompt: a locked governance charter first,
then each region ordered by meaning, with each node's weight setting its emphasis
(PRIMARY command → standing line → minor consideration) and every tempering
synapse spelled out as an explicit "when these conflict, X wins" tension. Same
graph ⇒ byte-identical prompt ⇒ the same `#hash` shown in the header. **⚡ Pulse**
lets you type a question, watch the matching nodes fire across the canvas, read
the exact compiled lines that lit, and optionally "Think it through" (a Haiku call
on that very prompt). The compile-lens (Primary / Standing / Full) tunes how much
of the mind those surfaces reveal — the worker always runs on the **Full** prompt.

**The Worker drafts; it never publishes.** A built-in headless worker (mounted at
app root, running only while ZTS is open in a tab) reads the compiled mind and
works the pipeline one task per pass — drafting an SEO article into the **review**
queue, scouting and ranking prime creators, compiling a daily strategy brief, or
proposing new knowledge nodes for you to accept. Everything it produces lands in a
review queue or the work log as a **draft**: it never posts a Short, publishes an
article, or moves a creator past *contacted* on its own. The dock exposes the
honest levers — a play/pause switch, per-task-type toggles, a tasks-per-hour and
$/hour cap, and a live work log where hovering an entry replays its activation on
the canvas. An optional **evening shift** arms the worker for a nightly window
(e.g. 6–10pm) so drafts are waiting for morning review — same drafts-only rule
applies; it simply runs on a schedule instead of a manual switch.

The mind is portable: **Export JSON** downloads the full genome, **Import JSON**
replaces it (rejected via a toast if it fails `validateGenome`), a **mutation
history** records every edit, and **Reset to seed** restores the shipped ZTS
doctrine. State lives in the same `zts_` localStorage namespace as the rest of the
app — no new infrastructure — and the whole tab is built on the shared **light
design system** (`src/ui.jsx` tokens, Syne / DM Mono, white glass over the ZTS
canvas), so it looks and feels native next to every other tab.

## Stack

- Vite + React 18, single-page; design tokens + shared primitives in `src/ui.jsx`
- Supabase (`creators` / `shorts` / `articles` tables + auth); every write has a
  local fallback so the app still functions without configuration
- Netlify Functions: `claude` (Anthropic proxy), `shopify-publish` (blog posts)
- shorts-factory: Python 3.10+ / ffmpeg / faster-whisper, `factory/`
- Voicebox (optional): local desktop app at `127.0.0.1:17493` for cloned-voice
  voiceovers, `src/voicebox.jsx`

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
