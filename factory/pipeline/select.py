"""Stage 3 — select: propose 2-3 candidate clips with reasoning; pick one."""
from . import llm, util


def select(pdir, force: bool = False):
    p = util.paths(pdir)
    out = p["work"] / "clips.json"
    settings = util.load_settings(pdir)

    if out.exists() and not force:
        clips = util.read_json(out)
        print_candidates(clips)
        return clips

    transcript = util.read_json(p["work"] / "transcript.json")
    block = "\n".join(f"[{s['start']:.1f}-{s['end']:.1f}] {s['text']}"
                      for s in transcript["segments"])
    if len(block) > 120_000:
        print("WARNING: transcript is very long; consider splitting the raw "
              "footage into separate projects for better selection quality.")
        block = block[:120_000] + "\n[TRUNCATED]"

    c = settings["clip"]
    result = llm.call(
        "01_select", "01_clip_select.md",
        {"style_guide": util.style_guide_text(),
         "transcript_block": block,
         "candidates": c["candidates"],
         "min_seconds": c["min_seconds"],
         "max_seconds": c["max_seconds"],
         "max_window": c["max_seconds"] + 12},
        p, settings)

    if not result.get("candidates"):
        raise SystemExit("Selector returned no candidates — re-run `select`, or check "
                         "the LLM response in work/ for what went wrong.")

    words = transcript["words"]
    for cand in result["candidates"]:
        cand["start"], cand["end"] = _snap(cand["start"], cand["end"], words)

    result.setdefault("recommended", result["candidates"][0]["id"])
    result["chosen"] = result["recommended"]
    util.write_json(out, result)
    print_candidates(result)
    return result


def _snap(start: float, end: float, words: list) -> tuple:
    """Expand window edges to the nearest word boundaries so we never clip audio."""
    s, e = start, end
    for w in words:
        if w["start"] <= start <= w["end"]:
            s = w["start"] - 0.05
        if w["start"] <= end <= w["end"]:
            e = w["end"] + 0.05
    return max(0.0, round(s, 3)), round(e, 3)


def print_candidates(clips: dict):
    print("\nCandidate clips:")
    for c in clips["candidates"]:
        mark = " <== chosen" if c["id"] == clips.get("chosen") else ""
        print(f"\n  [{c['id']}] {util.fmt_ts(c['start'])} - {util.fmt_ts(c['end'])} "
              f"({c['end'] - c['start']:.0f}s raw)  score {c.get('score', '?')}{mark}")
        print(f"      hook: {c.get('hook', '')}")
        print(f"      why:  {c.get('why', '')}")
        print(f"      risk: {c.get('risk', '')}")
    print(f"\nRecommended: {clips.get('recommended')}   "
          f"(switch with: python -m pipeline.cli choose <project> <ID>)")


def choose(pdir, clip_id: str):
    p = util.paths(pdir)
    clips = util.read_json(p["work"] / "clips.json")
    ids = [c["id"] for c in clips["candidates"]]
    if clip_id not in ids:
        raise SystemExit(f"No candidate '{clip_id}'. Options: {ids}")
    clips["chosen"] = clip_id
    util.write_json(p["work"] / "clips.json", clips)
    print(f"Chosen candidate: {clip_id}. Downstream stages will re-run on next draft.")
    return clips


def chosen_candidate(pdir) -> dict:
    clips = util.read_json(util.paths(pdir)["work"] / "clips.json")
    cid = clips.get("chosen", clips.get("recommended"))
    return next(c for c in clips["candidates"] if c["id"] == cid)
