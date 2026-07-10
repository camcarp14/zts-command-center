# Troubleshooting

**Captions render in a generic font.** libass couldn't match `captions.font` to a file. Check the TTF is in `assets/fonts/`, and that the setting matches the font's *family name*, not the filename: `fc-scan assets/fonts/YourFont.ttf | grep family`. ffmpeg's log line `fontselect: ... -> using default` confirms this is the issue.

**Pop-up text looks jagged/tiny.** Pillow found no TTF and fell back to a bitmap font — same fix: put a TTF in `assets/fonts/`.

**Audio drifts from captions on phone footage.** Phones record variable frame rate. The pipeline forces CFR at 30fps during segment encoding, which handles most cases; if drift persists, normalize first: `ffmpeg -i phone.mp4 -r 30 -c:v libx264 -crf 18 -c:a aac fixed.mp4` and ingest that.

**Transcription is slow.** `whisper_model: small` on CPU runs ~real-time on a modern laptop. Drop to `base` for drafts of long footage, or set `whisper_device: cuda` + `whisper_compute: float16` on an NVIDIA machine. First run downloads the model (needs network once).

**Wrong words in captions.** Bump `whisper_model` to `medium`, or hand-fix `work/cut_words.json` and re-run `captions` + `draft` — captions rebuild from that file, so manual fixes stick until the next re-cut.

**"Could not parse JSON" after an LLM stage.** The raw reply is saved at `work/llm/<stage>.response.txt`. Nine times out of ten the model added prose around the JSON — delete the prose, keep valid JSON, re-run. In manual mode, tell the chat model "JSON only, no commentary" and re-paste.

**ffmpeg "No such filter" / filtergraph errors.** You need ffmpeg 6+ built with libass (`ffmpeg -filters | grep ass` should show it). Homebrew and apt builds include it. Windows-native paths (`C:\...`) contain a colon that breaks filtergraphs — run inside WSL2.

**Export refuses to run.** Working as designed: `approve` the latest draft first. `export --skip-approval` exists for emergencies; using it routinely defeats the point of the system.

**A revision did something you didn't want.** Every round is logged (`drafts/feedback_vN.md` shows how feedback was interpreted). Your cut adjustments live in `work/user_cuts.json` — delete an entry and run `cut` then `draft` to undo. Caption overrides live in the project's `overrides.yaml`.

**Face-detect crop centered on the wrong thing.** Set `reframe.mode: offset` and `offset_x` (0=left, 1=right) in the project's `overrides.yaml`, then re-run `cut`.
