"""Stage 4 — cut: tighten the chosen window and render the 9:16 rough cut.

Cut sources, merged into one EDL:
  1. Deterministic dead-air trimming from word-gap analysis (no LLM needed).
  2. LLM-flagged cuts: fillers, retakes, rambling (prompt 02).
  3. Regex fallback: bare "um"/"uh" always die, even in manual mode.

Everything downstream depends on the EDL, so it's saved with full provenance
(work/edl.json) and every kept word is remapped onto the output timeline
(work/cut_words.json) for captions and pop-up timing.
"""
import re

from . import llm, reframe, select, util

FILLER_RE = re.compile(r"^(u+m+|u+h+|er+m*|mm+)[,.!?]?$", re.IGNORECASE)


def cut(pdir, force: bool = False, skip_llm: bool = False):
    p = util.paths(pdir)
    out_edl = p["work"] / "edl.json"
    if out_edl.exists() and not force:
        print("EDL exists (use --force to redo).")
        return util.read_json(out_edl)

    settings = util.load_settings(pdir)
    state = util.load_state(pdir)
    cand = select.chosen_candidate(pdir)
    transcript = util.read_json(p["work"] / "transcript.json")

    ws, we = cand["start"], cand["end"]
    words = [w for w in transcript["words"]
             if w["start"] >= ws - 0.25 and w["end"] <= we + 0.25]
    if not words:
        raise SystemExit("No words inside the chosen window -- check clips.json times.")

    cc = settings["cut"]

    # --- 1. deterministic dead-air cuts + edge trims -------------------------
    cuts = []
    trim_start = max(ws, words[0]["start"] - 0.15)
    trim_end = min(we, words[-1]["end"] + 0.35)
    for a, b in zip(words, words[1:]):
        gap = b["start"] - a["end"]
        if gap > cc["max_silence"]:
            keep = cc["keep_gap"]
            cuts.append({"start": round(a["end"] + keep / 2, 3),
                         "end": round(b["start"] - keep / 2, 3),
                         "reason": f"dead air ({gap:.1f}s -> {keep:.2f}s)"})

    # --- 2. LLM tighten (fillers / retakes / rambling) -----------------------
    if not skip_llm:
        words_block = "\n".join(
            f"{i} | {w['start']:.2f} | {w['end']:.2f} | {w['text']}"
            for i, w in enumerate(words))
        result = llm.call(
            "02_tighten", "02_tighten_cut.md",
            {"window_start": f"{ws:.2f}", "window_end": f"{we:.2f}",
             "window_duration": f"{we - ws:.1f}",
             "min_seconds": settings["clip"]["min_seconds"],
             "max_seconds": settings["clip"]["max_seconds"],
             "max_removed_pct": int(cc["max_removed_fraction"] * 100),
             "words_block": words_block},
            p, settings, temperature=0.2)
        trim_start = max(trim_start, float(result.get("trim_start", trim_start)))
        trim_end = min(trim_end, float(result.get("trim_end", trim_end)))
        for c in result.get("cuts", []):
            cuts.append({"start": float(c["start"]) - cc["edge_pad"],
                         "end": float(c["end"]) + cc["edge_pad"],
                         "reason": c.get("reason", "llm cut")})

    # --- 3. regex fallback for bare fillers ----------------------------------
    for w in words:
        if FILLER_RE.match(w["text"]):
            cuts.append({"start": w["start"] - 0.02, "end": w["end"] + 0.02,
                         "reason": f"filler: {w['text']}"})

    # --- 4. persistent user adjustments from the revision loop ---------------
    uc_file = p["work"] / "user_cuts.json"
    if uc_file.exists():
        uc = util.read_json(uc_file)
        for c in uc.get("add", []):
            cuts.append({"start": c["start"], "end": c["end"],
                         "reason": c.get("reason", "creator feedback")})
        for sup in uc.get("suppress", []):
            cuts = [c for c in cuts
                    if not (c["start"] < sup["end"] and c["end"] > sup["start"])]

    edl = _build_edl(pdir, [trim_start, trim_end], cuts, words, settings)
    render_roughcut(pdir, edl, settings, state)
    return edl


def _build_edl(pdir, window, cuts, words, settings) -> dict:
    p = util.paths(pdir)
    cc = settings["cut"]
    segs = util.subtract_ranges(window, [[c["start"], c["end"]] for c in cuts])
    segs = util.clean_segments(segs, cc["min_segment"], cc["join_gap"])

    dur = util.total_duration(segs)
    raw_dur = window[1] - window[0]
    if raw_dur - dur > raw_dur * cc["max_removed_fraction"]:
        print(f"WARNING: cuts remove {raw_dur - dur:.1f}s of {raw_dur:.1f}s -- "
              f"over the {cc['max_removed_fraction']:.0%} ceiling. Review edl.json.")
    if dur < settings["clip"]["min_seconds"]:
        print(f"WARNING: tightened clip is {dur:.1f}s, under the "
              f"{settings['clip']['min_seconds']}s floor.")

    edl = {"window": [round(window[0], 3), round(window[1], 3)],
           "cuts": sorted(cuts, key=lambda c: c["start"]),
           "segments": [[round(s, 3), round(e, 3)] for s, e in segs],
           "duration": round(dur, 3),
           "removed_seconds": round(raw_dur - dur, 3)}
    util.write_json(p["work"] / "edl.json", edl)

    # Remap surviving words onto the output timeline for captions/pop-ups.
    cut_words = []
    for w in words:
        mid = (w["start"] + w["end"]) / 2
        if any(s <= mid <= e for s, e in segs):
            cut_words.append({
                "start": round(util.remap_time(w["start"], segs), 3),
                "end": round(util.remap_time(w["end"], segs), 3),
                "text": w["text"]})
    util.write_json(p["work"] / "cut_words.json", cut_words)
    (p["work"] / "cut_transcript.txt").write_text(_cut_transcript_text(cut_words))

    print(f"EDL: {len(segs)} kept segments, {edl['removed_seconds']:.1f}s removed, "
          f"final duration {dur:.1f}s")
    return edl


def _cut_transcript_text(cut_words: list) -> str:
    lines, line, line_start = [], [], 0.0
    for w in cut_words:
        if not line:
            line_start = w["start"]
        line.append(w["text"])
        if len(line) >= 12 or w["text"].rstrip().endswith((".", "?", "!")):
            lines.append(f"[{util.fmt_ts(line_start)}] {' '.join(line)}")
            line = []
    if line:
        lines.append(f"[{util.fmt_ts(line_start)}] {' '.join(line)}")
    return "\n".join(lines)


def render_roughcut(pdir, edl, settings, state):
    """Cut each kept segment (frame-accurate re-encode with crop baked in), concat."""
    p = util.paths(pdir)
    raw = state["raw"]
    crop = reframe.compute_crop(raw, edl["window"], settings, state)
    util.write_json(p["work"] / "crop.json", crop)
    vf = reframe.crop_vf(crop, settings)

    for f in p["segs"].glob("seg_*.mp4"):
        f.unlink()
    out = settings["output"]
    seg_crf = str(out.get("segment_crf", 18))
    seg_preset = out.get("segment_preset", "fast")
    names = []
    for i, (s, e) in enumerate(edl["segments"]):
        seg = p["segs"] / f"seg_{i:03d}.mp4"
        util.run(["ffmpeg", "-y", "-ss", f"{s:.3f}", "-i", raw, "-t", f"{e - s:.3f}",
                  "-vf", vf,
                  "-c:v", "libx264", "-crf", seg_crf, "-preset", seg_preset,
                  "-pix_fmt", "yuv420p",
                  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                  seg])
        names.append(seg.name)

    listfile = p["segs"] / "concat.txt"
    listfile.write_text("".join(f"file '{n}'\n" for n in names))
    rough = p["work"] / "roughcut.mp4"
    util.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "concat.txt",
              "-c", "copy", "../roughcut.mp4"], cwd=p["segs"])
    print(f"Rough cut rendered: {rough}")
    return rough
