# Workflow reference

## Stage-by-stage

**1. ingest** (`new`) — copies footage into `raw/`, extracts 16kHz mono WAV for whisper, records dimensions/duration in `project.json`. Multiple `--video` flags get normalized and concatenated into one raw timeline (slower; single-file is the fast path).

**2. transcribe** — faster-whisper locally with word-level timestamps and VAD. Output: `work/transcript.json` (segments + words) and readable `transcript.txt`. Model size is `whisper_model` in settings: `small` is the speed/accuracy sweet spot on CPU; jump to `medium` only if you see wrong words in captions.

**3. select** — LLM proposes candidates with hook/why/risk/score (prompt `01`), windows snapped to word boundaries. `work/clips.json` holds them; `choose <ID>` switches. The scoring rubric lives in the prompt — edit it as you learn what performs for ZTS.

**4. cut** — three cut sources merged into one EDL: deterministic dead-air trimming from word gaps (`cut.max_silence` → `cut.keep_gap`), LLM-flagged fillers/retakes/rambles (prompt `02`, cached in `work/llm/`), and a regex that always kills bare um/uh. Plus your revision-loop adjustments from `work/user_cuts.json`. Kept segments are re-encoded frame-accurately with the 9:16 crop baked in, then concatenated → `work/roughcut.mp4`. Every surviving word is remapped to the output timeline (`cut_words.json`) — that remap is what keeps captions and pop-ups in sync.

**5. reframe** (inside cut) — one static crop per clip. `auto` samples frames and centers on the median detected face; falls back to center. Static is a V1 feature, not a limitation: bad tracking looks worse than no tracking.

**6. captions** — words grouped ≤3 per card, uppercase, subtle pop-in, spoken word tinted with `captions.highlight_color`, positioned at `y_pos` (0.72 clears the Shorts UI). Rendered as ASS (`work/captions.ass`), burned by libass. Every style knob is in settings and adjustable mid-revision ("captions bigger" → the revise loop writes `overrides.yaml`).

**7. popups** — prompt `03` proposes placements under hard restraint rules (budget of `max_per_30s`, nothing in first 1.5s, never two at once, out of the caption band); code re-validates all of that, then Pillow renders each as a full-frame transparent PNG (`work/overlays/`). B-roll ideas come back as notes in the review doc, not renders — see V2_ROADMAP for why.

**8. package** — prompt `04` → titles ×5, description, pinned comment, CTAs, thumbnail concept, hashtags → `work/package.json`.

**9. draft + review** — ffmpeg composites roughcut + captions + faded overlays + `DRAFT vN` watermark at fast/low-quality settings → `drafts/draft_vN.mp4`, and `drafts/REVIEW_vN.md` assembles everything a reviewer needs.

**10. revise** — your feedback + full current state → prompt `05` → a constrained action list (window shifts, add/remove cuts, caption style, pop-up edits, package edits, candidate switch). The system applies them, re-runs only dirty stages, renders v(N+1). Feedback times refer to the draft you watched; conversion to source time is automatic. Anything the ops can't express comes back as a `note` telling you the manual step. Each round is logged to `drafts/feedback_vN.md`. One behavior to know: if a revision re-cuts the video and you didn't explicitly edit pop-ups in the same message, pop-ups regenerate (their old timings would be wrong anyway).

**11. approve + export** — `approve` stamps the current draft version; `export` refuses without it, then renders final quality (CRF 18, slow preset, −14 LUFS loudness, faststart) → `final/final.mp4` + `final/PACKAGE.md`.

## Manual LLM mode (no API key / no Claude)

Set no `ANTHROPIC_API_KEY` (or `export SHORTS_MANUAL=1`). Any stage needing the LLM will:

1. Write the fully-filled prompt to `work/llm/<stage>.prompt.md` and stop.
2. You paste that file's contents into any capable chat LLM.
3. Save the model's raw JSON reply to `work/llm/<stage>.response.txt`.
4. Re-run the same command — it picks up the response and continues.

Five pastes per video start-to-finish (select, tighten, popups, package, then one per revision). Tedious but fully functional, and it means the system works with any model vendor, forever. Responses are cached; `--force` clears and re-asks.

## Output formats (the contract between stages)

| File | What |
|---|---|
| `work/transcript.json` | `{language, segments[], words[{start,end,text}]}` raw timeline |
| `work/clips.json` | candidates + `chosen` id |
| `work/edl.json` | `{window, cuts[{start,end,reason}], segments[[s,e]], duration, removed_seconds}` |
| `work/cut_words.json` | surviving words on the OUTPUT timeline |
| `work/user_cuts.json` | your persistent add/suppress cut adjustments |
| `work/captions.ass` + `.txt` | burnable subtitles + readable preview |
| `work/popups.json` + `overlays/*.png` | placements + rendered graphics |
| `work/package.json` | titles/description/pinned/CTAs/thumbnail/hashtags |
| `drafts/REVIEW_vN.md`, `feedback_vN.md` | review doc, feedback log |
| `final/final.mp4`, `final/PACKAGE.md` | deliverables |

Every one is hand-editable. Edit `popups.json` and run `draft`? Works. Fix a mis-heard word in `cut_words.json` and run `captions` then `draft`? Works. The CLI is convenience, not a cage.
