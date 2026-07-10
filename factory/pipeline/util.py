"""Shared utilities: settings, project state, ffmpeg helpers, EDL math."""
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------- settings

def _deep_merge(base: dict, over: dict) -> dict:
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v
    return base


def load_settings(project_dir: Path | None = None) -> dict:
    settings = yaml.safe_load((ROOT / "config" / "settings.yaml").read_text())
    if project_dir:
        ov = Path(project_dir) / "overrides.yaml"
        if ov.exists():
            _deep_merge(settings, yaml.safe_load(ov.read_text()) or {})
    return settings


def save_override(project_dir: Path, dotted_updates: dict):
    """Merge e.g. {'captions': {'font_size': 104}} into the project's overrides.yaml."""
    ov = Path(project_dir) / "overrides.yaml"
    current = yaml.safe_load(ov.read_text()) if ov.exists() else {}
    current = current or {}
    _deep_merge(current, dotted_updates)
    ov.write_text(yaml.safe_dump(current, sort_keys=False))


def style_guide_text() -> str:
    return (ROOT / "config" / "zts_style.md").read_text()


# ---------------------------------------------------------------- projects

def project_dir(name: str) -> Path:
    p = Path(name)
    if p.exists():
        return p.resolve()
    settings = load_settings()
    p = ROOT / settings["paths"]["projects_dir"] / name
    if not p.exists():
        sys.exit(f"Project not found: {name}")
    return p.resolve()


def paths(pdir: Path) -> dict:
    d = {
        "raw": pdir / "raw",
        "work": pdir / "work",
        "segs": pdir / "work" / "segs",
        "overlays": pdir / "work" / "overlays",
        "llm": pdir / "work" / "llm",
        "drafts": pdir / "drafts",
        "final": pdir / "final",
    }
    for v in d.values():
        v.mkdir(parents=True, exist_ok=True)
    d["project"] = pdir
    return d


def load_state(pdir: Path) -> dict:
    f = pdir / "project.json"
    return json.loads(f.read_text()) if f.exists() else {}


def save_state(pdir: Path, **updates):
    state = load_state(pdir)
    state.update(updates)
    (pdir / "project.json").write_text(json.dumps(state, indent=2))
    return state


def read_json(p: Path):
    return json.loads(Path(p).read_text())


def write_json(p: Path, obj):
    Path(p).write_text(json.dumps(obj, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------- ffmpeg

def run(cmd: list, cwd: Path | None = None, quiet: bool = True):
    printable = " ".join(shlex.quote(str(c)) for c in cmd)
    print(f"  $ {printable[:240]}{'...' if len(printable) > 240 else ''}")
    kw = {}
    if quiet:
        kw = dict(stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    result = subprocess.run([str(c) for c in cmd], cwd=cwd, **kw)
    if result.returncode != 0:
        if quiet:
            print(result.stderr[-3000:] if result.stderr else "")
        raise RuntimeError(f"Command failed ({result.returncode}): {printable[:200]}")
    return result


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def video_dims(path: Path) -> tuple[int, int, float]:
    info = ffprobe(path)
    vs = next(s for s in info["streams"] if s["codec_type"] == "video")
    dur = float(info["format"].get("duration", 0) or 0)
    return int(vs["width"]), int(vs["height"]), dur


# ---------------------------------------------------------------- EDL math
# The EDL is a sorted list of kept [start, end] spans on the RAW timeline.
# Everything downstream (captions, pop-ups) lives on the OUTPUT timeline,
# so the remap functions here are what keep audio, text, and graphics in sync.

def merge_ranges(ranges: list) -> list:
    """Merge overlapping/adjacent [s,e] ranges."""
    if not ranges:
        return []
    rs = sorted([list(r) for r in ranges])
    out = [rs[0]]
    for s, e in rs[1:]:
        if s <= out[-1][1] + 1e-6:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def subtract_ranges(window: list, cuts: list) -> list:
    """Kept segments = window minus cut ranges."""
    ws, we = window
    kept = []
    cur = ws
    for cs, ce in merge_ranges([[max(ws, c[0]), min(we, c[1])] for c in cuts
                                if c[1] > ws and c[0] < we]):
        if cs > cur + 1e-6:
            kept.append([cur, cs])
        cur = max(cur, ce)
    if we > cur + 1e-6:
        kept.append([cur, we])
    return kept


def clean_segments(segs: list, min_segment: float, join_gap: float) -> list:
    """Merge segments separated by tiny gaps, then drop segments too short to keep."""
    if not segs:
        return []
    merged = [list(segs[0])]
    for s, e in segs[1:]:
        if s - merged[-1][1] < join_gap:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [seg for seg in merged if seg[1] - seg[0] >= min_segment]


def total_duration(segs: list) -> float:
    return sum(e - s for s, e in segs)


def remap_time(t: float, segs: list) -> float:
    """Raw-timeline time -> output-timeline time (clamps into nearest kept span)."""
    acc = 0.0
    for s, e in segs:
        if t < s:
            return acc
        if t <= e:
            return acc + (t - s)
        acc += e - s
    return acc


def inverse_remap(t_out: float, segs: list) -> float:
    """Output-timeline time -> raw-timeline time."""
    acc = 0.0
    for s, e in segs:
        d = e - s
        if t_out <= acc + d:
            return s + (t_out - acc)
        acc += d
    return segs[-1][1] if segs else 0.0


# ---------------------------------------------------------------- formatting

def sec_to_ass(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def fmt_ts(t: float) -> str:
    m = int(t // 60)
    return f"{m}:{t % 60:04.1f}"


def hex_to_ass_style(hex_color: str) -> str:
    """#RRGGBB -> &H00BBGGRR (ASS style-table color, alpha first)."""
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def hex_to_ass_inline(hex_color: str) -> str:
    """#RRGGBB -> &HBBGGRR& (inline \\1c override)."""
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{b}{g}{r}&".upper()


def hex_to_rgb(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def even(v: float) -> int:
    v = int(round(v))
    return v - (v % 2)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48]


def rel_from(base: Path, target: Path) -> str:
    """Relative path with forward slashes (filtergraph-safe)."""
    return os.path.relpath(target, base).replace("\\", "/")
