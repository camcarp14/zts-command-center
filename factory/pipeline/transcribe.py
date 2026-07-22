"""Stage 2 — transcribe: local faster-whisper with word-level timestamps.

Output: work/transcript.json
  {"language": "en",
   "segments": [{"start", "end", "text"}, ...],
   "words":    [{"start", "end", "text"}, ...]}
and a human-readable work/transcript.txt.
"""
from . import util


def transcribe(pdir, force: bool = False):
    p = util.paths(pdir)
    out = p["work"] / "transcript.json"
    if out.exists() and not force:
        print("Transcript exists (use --force to redo).")
        return util.read_json(out)

    settings = util.load_settings(pdir)
    from faster_whisper import WhisperModel  # lazy: heavy import
    print(f"Loading whisper model '{settings['whisper_model']}' "
          f"({settings['whisper_device']}/{settings['whisper_compute']})...")
    model = WhisperModel(settings["whisper_model"],
                         device=settings["whisper_device"],
                         compute_type=settings["whisper_compute"])

    print("Transcribing (first run downloads the model)...")
    segments_iter, info = model.transcribe(
        str(p["work"] / "audio.wav"),
        word_timestamps=True,
        vad_filter=True,
        language=settings.get("language") or None,
    )

    segments, words = [], []
    for seg in segments_iter:
        segments.append({"start": round(seg.start, 3), "end": round(seg.end, 3),
                         "text": seg.text.strip()})
        for w in (seg.words or []):
            token = w.word.strip()
            if token:
                words.append({"start": round(w.start, 3), "end": round(w.end, 3),
                              "text": token})

    data = {"language": info.language, "segments": segments, "words": words}
    util.write_json(out, data)
    (p["work"] / "transcript.txt").write_text(
        "\n".join(f"[{util.fmt_ts(s['start'])}] {s['text']}" for s in segments),
        encoding="utf-8")
    print(f"Transcribed: {len(segments)} segments, {len(words)} words "
          f"-> {out.name}")
    return data
