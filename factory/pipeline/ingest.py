"""Stage 1 — ingest: create a project folder, bring in raw footage, extract audio."""
import datetime
import shutil
from pathlib import Path

from . import util


def new_project(name: str, videos: list[str]) -> Path:
    settings = util.load_settings()
    slug = util.slugify(name)
    pdir = util.ROOT / settings["paths"]["projects_dir"] / \
        f"{datetime.date.today().isoformat()}_{slug}"
    if pdir.exists():
        raise SystemExit(f"Project already exists: {pdir}")
    p = util.paths(pdir)

    sources = [Path(v).expanduser().resolve() for v in videos]
    for s in sources:
        if not s.exists():
            raise SystemExit(f"Video not found: {s}")

    if len(sources) == 1:
        raw = p["raw"] / f"source{sources[0].suffix.lower()}"
        shutil.copy2(sources[0], raw)
    else:
        # Multiple takes/files: normalize + concatenate into one raw timeline.
        print(f"Concatenating {len(sources)} files into one raw timeline (re-encode)...")
        norm = []
        for i, s in enumerate(sources):
            out = p["work"] / f"norm_{i}.mp4"
            util.run(["ffmpeg", "-y", "-i", s,
                      "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                      "-r", str(settings["output"]["fps"]), "-pix_fmt", "yuv420p",
                      "-c:a", "aac", "-ar", "48000", "-ac", "2", out])
            norm.append(out)
        listfile = p["work"] / "concat.txt"
        listfile.write_text("".join(f"file '{n.name}'\n" for n in norm))
        raw = p["raw"] / "source.mp4"
        util.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listfile,
                  "-c", "copy", raw], cwd=p["work"])

    w, h, dur = util.video_dims(raw)
    print(f"Raw footage: {w}x{h}, {dur:.1f}s")

    audio = p["work"] / "audio.wav"
    util.run(["ffmpeg", "-y", "-i", raw, "-vn", "-ac", "1", "-ar", "16000",
              "-c:a", "pcm_s16le", audio])

    util.save_state(pdir, raw=str(raw), width=w, height=h, duration=dur,
                    draft_version=0, approved_version=None)
    print(f"\nProject created: {pdir}")
    print(f"Next: python -m pipeline.cli run {pdir.name}")
    return pdir
