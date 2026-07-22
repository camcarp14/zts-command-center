"""Stage 7 — render: roughcut + captions + overlays (+ watermark) -> mp4.

One filtergraph builder serves both draft and final export; the only deltas
are CRF/preset and the DRAFT watermark. Runs ffmpeg with cwd = project dir and
relative paths, which sidesteps filtergraph path-escaping entirely.
"""
from . import util


def render(pdir, final: bool = False, version: int | None = None) -> str:
    p = util.paths(pdir)
    settings = util.load_settings(pdir)
    o = settings["output"]
    state = util.load_state(pdir)

    if final:
        out_rel = "final/final.mp4"
    else:
        version = version or state.get("draft_version", 0) + 1
        out_rel = f"drafts/draft_v{version}.mp4"

    overlays = util.read_json(p["work"] / "overlays.json") \
        if (p["work"] / "overlays.json").exists() else []

    inputs = ["-i", "work/roughcut.mp4"]
    steps = []
    fonts_rel = util.rel_from(pdir, util.ROOT / settings["paths"]["fonts_dir"])
    captions_rel = util.rel_from(pdir, p["work"] / "captions.ass")
    if ":" in fonts_rel or ":" in captions_rel:
        print("WARNING: path contains ':' which breaks ffmpeg filtergraphs -- "
              "keep the repo and projects on the same drive / use WSL.")
    steps.append(f"[0:v]ass=work/captions.ass:fontsdir={fonts_rel}[v0]")

    fade = settings["popups"]["fade"]
    idx = 1
    last = "v0"
    for ov in overlays:
        inputs += ["-loop", "1", "-i", f"work/overlays/{ov['png']}"]
        t0, t1 = ov["t0"], ov["t1"]
        steps.append(
            f"[{idx}:v]format=rgba,"
            f"fade=t=in:st={t0:.2f}:d={fade}:alpha=1,"
            f"fade=t=out:st={max(t0, t1 - fade):.2f}:d={fade}:alpha=1[o{idx}]")
        steps.append(
            f"[{last}][o{idx}]overlay=0:0:enable='between(t,{t0:.2f},{t1:.2f})'[v{idx}]")
        last = f"v{idx}"
        idx += 1

    if not final:
        wm = _watermark(pdir, version, settings)
        inputs += ["-loop", "1", "-i", f"work/{wm}"]
        steps.append(f"[{last}][{idx}:v]overlay=24:24[vout]")
        last = "vout"

    crf = o["final_crf"] if final else o["draft_crf"]
    preset = o["final_preset"] if final else o["draft_preset"]
    cmd = (["ffmpeg", "-y"] + inputs +
           ["-filter_complex", ";".join(steps),
            "-map", f"[{last}]", "-map", "0:a",
            "-af", f"loudnorm={o['loudnorm']}",
            "-c:v", "libx264", "-crf", str(crf), "-preset", preset,
            "-r", str(o["fps"]), "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", o["audio_bitrate"],
            "-shortest", "-movflags", "+faststart",
            out_rel])
    util.run(cmd, cwd=pdir)

    if not final:
        util.save_state(pdir, draft_version=version)
    print(f"\nRendered: {pdir / out_rel}")
    return str(pdir / out_rel)


def _watermark(pdir, version: int, settings: dict) -> str:
    from PIL import Image, ImageDraw
    from .popups import _font
    text = f"DRAFT v{version} - NOT FOR PUBLISH"
    font = _font(40)
    img = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), text, font=font)
    img = Image.new("RGBA", (bbox[2] + 28, bbox[3] + 22), (0, 0, 0, 110))
    d = ImageDraw.Draw(img)
    d.text((14 - bbox[0], 10 - bbox[1]), text, font=font, fill=(255, 255, 255, 200))
    name = "watermark.png"
    img.save(util.paths(pdir)["work"] / name)
    return name
