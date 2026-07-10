# shorts-factory

A local, owned pipeline that turns raw talking footage into a polished 9:16 YouTube Short — with a mandatory human review/approval gate before final export. Built for Zero To Secure educational and product content, reusable for anything.

**Pipeline:** ingest → transcribe (local whisper) → LLM picks 2–3 candidate clips with reasoning → tighten (dead air, fillers, retakes, rambles) → static face-aware 9:16 crop → animated word-highlight captions → restrained pop-ups (text pills / arrows / circles / highlights / product PNGs) → watermarked draft + full review doc → plain-English revision loop → approved final MP4 + packaging (titles, description, pinned comment, CTAs, thumbnail concept).

## Honest build-vs-buy note

If the only goal were speed-to-content, Opus Clip / Descript get you 80% of this today with zero setup. This pipeline wins on four things: cost at volume (whisper is free, LLM calls are pennies per Short), brand control (your caption style, your restraint rules, no template look), privacy (unreleased ZTS product footage never leaves your machine except transcript text to the LLM — and even that has an offline manual mode), and durability (plain Python + ffmpeg + markdown prompts; no vendor can sunset it). If you stop valuing those four, use the SaaS and spend the hours filming instead.

## Setup (once, ~10 minutes)

```bash
# 1. System dependency
brew install ffmpeg            # macOS   (Ubuntu: sudo apt install ffmpeg; Windows: use WSL2)

# 2. Python env (3.10+)
cd shorts-factory
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 3. Caption font — see assets/fonts/GET_FONTS.md (2 minutes, matters a lot)

# 4. LLM access (optional but recommended)
export ANTHROPIC_API_KEY=sk-ant-...    # get one at console.anthropic.com; docs: docs.claude.com
# No key? The pipeline runs in MANUAL MODE: it writes each prompt to a file,
# you paste it into any chat LLM, save the JSON reply, re-run. Slower, fully functional.

# 5. Verify
python -m pipeline.cli doctor

# 6. Make it yours (do not skip)
#    - config/zts_style.md   -> your actual brand voice/product facts (drives all creative calls)
#    - config/settings.yaml  -> brand.accent hex + captions.highlight_color
#    - assets/graphics/      -> drop in product/logo PNGs, update manifest.json
```

## Quickstart (per video)

```bash
python -m pipeline.cli new "seed phrase myths" --video ~/footage/take1.mp4
python -m pipeline.cli run 2026-07-07_seed-phrase-myths
# -> watch  projects/.../drafts/draft_v1.mp4  (watermarked)
# -> read   projects/.../drafts/REVIEW_v1.md  (clips + reasoning, cuts, captions,
#           pop-ups, b-roll notes, titles, description, pinned comment, CTAs, thumbnail)

python -m pipeline.cli revise 2026-07-07_seed-phrase-myths \
  "start 2s earlier, cut the tangent around 0:14, captions bigger, move the price pop to when I say the price"
# -> draft_v2.mp4 + REVIEW_v2.md   (loop as many times as needed)

python -m pipeline.cli approve 2026-07-07_seed-phrase-myths
python -m pipeline.cli export  2026-07-07_seed-phrase-myths
# -> final/final.mp4 + final/PACKAGE.md
```

Export refuses to run on an unapproved draft — the review gate is enforced, not suggested.

## Command reference

| Command | Does |
|---|---|
| `new <name> --video <path>` | create project, ingest footage (repeat `--video` to concat takes) |
| `run <project>` | full pipeline through draft v1 + review doc |
| `select` / `choose <ID>` | view candidates / switch to candidate B or C |
| `revise <project> "feedback"` | plain-English feedback → new draft |
| `cut` / `captions` / `popups` / `package` / `draft` | re-run individual stages (add `--force` to redo LLM calls) |
| `review` | print latest REVIEW doc |
| `approve` → `export` | approval gate, then final MP4 |
| `doctor` | environment check |

## What's where

```
config/settings.yaml     every knob: brand colors, caption style, clip length, cut aggressiveness
config/zts_style.md      brand/voice guide injected into every creative prompt  <- highest-leverage file
prompts/*.md             the 5 LLM contracts (select, tighten, popups, package, revise)
pipeline/*.py            one module per stage; JSON artifacts between stages
projects/<date>_<slug>/  raw/ work/ drafts/ final/ + project.json state
docs/                    WORKFLOW (details), SHOOTING_CHECKLIST, V2_ROADMAP, TROUBLESHOOTING
```

## Durability design

Everything between stages is inspectable JSON (`work/*.json`); fix any file by hand and re-run from there. The prompts are plain markdown with strict JSON output contracts — they work pasted into any capable chat model, which is exactly what manual mode automates around. The video engine is ffmpeg + libass, which will outlive us all. Nothing here depends on this system's author existing.
