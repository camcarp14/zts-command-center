"""End-to-end smoke test with NO whisper and NO LLM calls.

Fabricates synthetic footage, a word-level transcript, and canned LLM
responses, then drives the real pipeline: select -> cut -> captions -> popups
-> package -> draft -> revise -> approve -> export. Run it after setup to
verify ffmpeg/libass/Pillow work on your machine (costs zero API tokens):

    python tests/smoke_test.py            # full run
    python tests/smoke_test.py --phase1   # stop after draft v1
    python tests/smoke_test.py --resume   # revision + export on an existing phase-1 run
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["SHORTS_MANUAL"] = "1"
os.chdir(ROOT)

PHASE1_ONLY = "--phase1" in sys.argv
RESUME = "--resume" in sys.argv

from pipeline import captions, cut, ingest, package, popups, render, revise, select, util
from pipeline.llm import ManualModeExit


def check(label, cond):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        sys.exit(1)


# ---------------------------------------------------------------- unit checks
segs = util.subtract_ranges([5.0, 45.0], [[10.0, 12.0], [20.0, 21.0]])
check("subtract_ranges", segs == [[5.0, 10.0], [12.0, 20.0], [21.0, 45.0]])
check("remap", abs(util.remap_time(13.0, segs) - 6.0) < 1e-6)
t = 17.3
check("remap/inverse roundtrip",
      abs(util.inverse_remap(util.remap_time(t, segs), segs) - t) < 1e-6)
check("clean_segments merges",
      util.clean_segments([[0, 5], [5.05, 9], [9.5, 9.7]], 0.4, 0.12) == [[0, 9]])
check("hex->ass style", util.hex_to_ass_style("#FFB13B") == "&H003BB1FF")
check("ass time", util.sec_to_ass(83.5) == "0:01:23.50")

# ------------------------------------------------- synthetic transcript data
# Hook at 5s, an "um" filler, a 1.4s dead-air gap, a retake, a ramble, payoff.
words, cursor = [], 5.0
script = [
    ("This is how people lose their Bitcoin forever .".split(), 0.0),
    ("um".split(), 0.1),
    ("A hardware wallet costs one hundred twenty dollars .".split(), 1.4),
    ("the plate costs the plate costs twenty one dollars .".split(), 0.1),
    ("and honestly you know what I mean it is kind of a thing .".split(), 0.1),
    ("Steel survives the house fire paper does not .".split(), 0.2),
    ("Stamp the words once check them twice and forget it .".split(), 0.1),
    ("Twenty one dollars versus one hundred twenty easy choice .".split(), 0.0),
]
for tokens, gap_after in script:
    for tk in tokens:
        dur = 0.12 if tk in (".", ",") else 0.28
        words.append({"start": round(cursor, 3), "end": round(cursor + dur, 3),
                      "text": tk})
        cursor += dur + 0.06
    cursor += gap_after
transcript = {"language": "en",
              "segments": [{"start": 5.0, "end": round(cursor, 2),
                            "text": " ".join(w["text"] for w in words)}],
              "words": words}
window_end = round(cursor, 2)

def w_at(sub):
    """Start/end times of the first occurrence of a word subsequence."""
    toks = [w["text"] for w in words]
    for i in range(len(toks) - len(sub) + 1):
        if toks[i:i + len(sub)] == sub:
            return words[i]["start"], words[i + len(sub) - 1]["end"]
    raise AssertionError(f"subsequence not found: {sub}")

retake_s, retake_e = w_at("the plate costs".split())          # first take
ramble_s, ramble_e = w_at("and honestly you know what I mean".split())

# ---------------------------------------------------------------- fixtures
proj_root = ROOT / "projects"
if RESUME:
    existing = sorted(proj_root.glob("*smoke-test*"))
    if not existing or not (existing[-1] / "drafts" / "draft_v1.mp4").exists():
        sys.exit("--resume needs a completed --phase1 run first")
    pdir = existing[-1]
    p = util.paths(pdir)
else:
    for old in proj_root.glob("*smoke-test*"):
        shutil.rmtree(old)

    footage = ROOT / "tests" / "_footage.mp4"
    footage.parent.mkdir(exist_ok=True)
    if not footage.exists():
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi",
             "-i", "testsrc2=duration=60:size=1920x1080:rate=30",
             "-f", "lavfi", "-i", "sine=frequency=330:duration=60",
             "-c:v", "libx264", "-crf", "24", "-preset", "veryfast",
             "-pix_fmt", "yuv420p", "-c:a", "aac", str(footage)],
            check=True, capture_output=True)

    # A product PNG so the image pop-up path is exercised.
    from PIL import Image, ImageDraw
    art = Image.new("RGBA", (400, 260), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    d.rounded_rectangle([10, 10, 390, 250], radius=20, fill=(120, 125, 132, 255),
                        outline=(255, 177, 59, 255), width=6)
    art.save(ROOT / "assets" / "graphics" / "zts_product.png")

    pdir = ingest.new_project("smoke test", [str(footage)])
    p = util.paths(pdir)

    # Fast encode settings for CI-ish speed; doubles as a test of the
    # per-project overrides mechanism (deep-merged over settings.yaml).
    # Raised popup budget compensates for the short synthetic clip.
    (pdir / "overrides.yaml").write_text(
        "output:\n  draft_crf: 32\n  draft_preset: ultrafast\n"
        "  final_crf: 30\n  final_preset: ultrafast\n"
        "  segment_crf: 32\n  segment_preset: ultrafast\n"
        "popups:\n  max_per_30s: 6\n")

    util.write_json(p["work"] / "transcript.json", transcript)
    (p["work"] / "transcript.txt").write_text("(smoke)")

RESPONSES = {
    "01_select": {
        "candidates": [
            {"id": "A", "start": 5.0, "end": window_end,
             "hook": "This is how people lose their Bitcoin forever",
             "summary": "price contrast payoff", "why": "strong hook, concrete payoff",
             "risk": "none", "score": 8.6},
            {"id": "B", "start": 5.0, "end": window_end - 4,
             "hook": "same", "summary": "alt", "why": "alt", "risk": "shorter",
             "score": 7.0}],
        "recommended": "A"},
    "02_tighten": {
        "trim_start": 5.0, "trim_end": window_end,
        "cuts": [
            {"start": retake_s, "end": retake_e, "reason": "retake: kept second take"},
            {"start": ramble_s, "end": ramble_e, "reason": "ramble"}],
        "surviving_text": "(smoke)", "notes": "(smoke)"},
    "03_popups": {
        "popups": [
            {"id": "p1", "type": "text", "t_start": 3.0, "t_end": 5.2,
             "text": "$21 vs $120", "x": 0.5, "y": 0.24, "intent": "contrast"},
            {"id": "p2", "type": "circle", "t_start": 6.0, "t_end": 8.0,
             "x": 0.6, "y": 0.4, "w": 0.2, "intent": "highlight"},
            {"id": "p3", "type": "arrow", "t_start": 9.0, "t_end": 10.8,
             "x1": 0.3, "y1": 0.2, "x2": 0.55, "y2": 0.42, "intent": "point"},
            {"id": "p4", "type": "image", "t_start": 12.0, "t_end": 14.0,
             "asset": "zts_product.png", "x": 0.5, "y": 0.28, "w": 0.3,
             "intent": "product"}],
        "broll_suggestions": [{"t": 6.0, "idea": "macro of plate", "source": "own"}],
        "restraint_check": "(smoke)"},
    "04_package": {
        "titles": ["t1", "t2", "t3", "t4", "t5"],
        "description": "line1\n\nLINKS: [store link] | [full video link]",
        "pinned_comment": "question?",
        "ctas": [{"placement": "end-card", "text": "cta"}],
        "thumbnail_concept": "concept", "hashtags": ["#bitcoin"]},
    "05_revise": {
        "actions": [
            {"op": "caption_style", "font_size": 110, "y_pos": 0.70},
            {"op": "add_cut", "start": 6.0, "end": 7.0, "reason": "tangent"},
            {"op": "edit_popup", "id": "p2", "t_start": 8.5, "t_end": 10.3},
            {"op": "note", "text": "add music manually"}],
        "summary": "bigger captions, one cut, moved p2"},
}


def with_response(stage, fn):
    """Real manual-mode flow: run (writes prompt, exits), drop response, run again."""
    try:
        return fn()
    except ManualModeExit:
        (p["llm"] / f"{stage}.response.txt").write_text(
            json.dumps(RESPONSES[stage]))
        return fn()


# ---------------------------------------------------------------- pipeline
if not RESUME:
    with_response("01_select", lambda: select.select(pdir))
    edl = with_response("02_tighten", lambda: cut.cut(pdir, force=True))
    um_s, um_e = w_at(["um"])
    expected = (window_end - 5.0) - (retake_e - retake_s) - \
        (ramble_e - ramble_s) - (um_e - um_s)
    check("edl duration plausible", abs(edl["duration"] - expected) < 2.5)
    check("roughcut exists", (p["work"] / "roughcut.mp4").exists())
    w, h, dur = util.video_dims(p["work"] / "roughcut.mp4")
    check("roughcut is 1080x1920", (w, h) == (1080, 1920))
    check("roughcut duration matches edl", abs(dur - edl["duration"]) < 1.0)

    groups = captions.build(pdir)
    ass = (p["work"] / "captions.ass").read_text()
    check("captions generated", "Dialogue:" in ass and "BITCOIN" in ass)
    check("no raw filler in captions", "UM" not in ass.split("Dialogue:")[1])

    with_response("03_popups", lambda: popups.plan(pdir))
    ovs = util.read_json(p["work"] / "overlays.json")
    check("4 overlays rendered", len(ovs) == 4)

    with_response("04_package", lambda: package.build_package(pdir))
    draft = render.render(pdir, final=False)
    check("draft v1 exists", Path(draft).exists())
    review = package.write_review(pdir, draft)
    rv = Path(review).read_text()
    check("review has all sections", all(s in rv for s in
          ["Selected clip", "Cuts applied", "Caption text", "Pop-ups",
           "B-roll", "Title options", "Pinned comment", "Thumbnail",
           "How to revise"]))
    if PHASE1_ONLY:
        print("\nPHASE 1 PASSED — continue with: python tests/smoke_test.py --resume")
        sys.exit(0)

# ---------------------------------------------------------------- revision loop
dur_before = util.read_json(p["work"] / "edl.json")["duration"]
with_response("05_revise",
              lambda: revise.revise(pdir, "bigger captions, cut tangent at 6s"))
state = util.load_state(pdir)
check("draft v2 rendered", state["draft_version"] == 2 and
      (pdir / "drafts" / "draft_v2.mp4").exists())
dur_after = util.read_json(p["work"] / "edl.json")["duration"]
check("revision cut removed ~1s", 0.4 < (dur_before - dur_after) < 1.6)
ov = (pdir / "overrides.yaml").read_text()
check("caption override persisted", "110" in ov)
check("feedback logged", (pdir / "drafts" / "feedback_v1.md").exists())

# ---------------------------------------------------------------- export gate
r = subprocess.run([sys.executable, "-m", "pipeline.cli", "export", pdir.name],
                   capture_output=True, text=True)
check("export blocked without approval", r.returncode != 0 and "not approved" in
      (r.stdout + r.stderr))
util.save_state(pdir, approved_version=state["draft_version"])
final = render.render(pdir, final=True)
fw, fh, fdur = util.video_dims(final)
check("final is 1080x1920", (fw, fh) == (1080, 1920))
check("final duration matches draft", abs(fdur - dur_after) < 1.0)

print("\nALL SMOKE TESTS PASSED — environment and pipeline are good.")
