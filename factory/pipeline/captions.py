"""Stage 5 — captions: animated word-highlight subtitles as an ASS file.

Style: groups of <=N uppercase words, subtle pop-in per group, the currently
spoken word tinted with the brand accent. This is the proven "readable + alive"
look without motion-graphics tooling; ffmpeg burns it in via libass.
"""
from . import util


def build(pdir, force: bool = True):
    p = util.paths(pdir)
    settings = util.load_settings(pdir)
    cw = util.read_json(p["work"] / "cut_words.json")
    if not cw:
        raise SystemExit("No cut words -- run the cut stage first.")

    groups = group_words(cw, settings)
    ass = render_ass(groups, settings)
    (p["work"] / "captions.ass").write_text(ass, encoding="utf-8")
    (p["work"] / "captions.txt").write_text(
        "\n".join(f"[{util.fmt_ts(g['start'])}] {' '.join(w['text'] for w in g['words'])}"
                  for g in groups))
    print(f"Captions: {len(groups)} groups -> captions.ass")
    return groups


def group_words(words: list, settings: dict) -> list:
    c = settings["captions"]
    groups, cur = [], []

    def flush():
        if cur:
            groups.append({"start": cur[0]["start"],
                           "end": cur[-1]["end"],
                           "words": list(cur)})
            cur.clear()

    for w in words:
        if cur:
            gap = w["start"] - cur[-1]["end"]
            prev = cur[-1]["text"].rstrip()
            if (len(cur) >= c["group_max_words"]
                    or gap > c["group_max_gap"]
                    or prev.endswith((".", "?", "!", ","))):
                flush()
        cur.append(w)
    flush()

    # Extend each group's visual end into the following silence (linger),
    # but never overlap the next group.
    for i, g in enumerate(groups):
        tail = settings["captions"]["hold_tail"]
        limit = groups[i + 1]["start"] - 0.02 if i + 1 < len(groups) else g["end"] + tail
        g["display_end"] = min(g["end"] + tail, max(limit, g["end"]))
    return groups


def _clean(text: str) -> str:
    return text.replace("{", "(").replace("}", ")").strip()


def render_ass(groups: list, settings: dict) -> str:
    c = settings["captions"]
    o = settings["output"]
    white = util.hex_to_ass_style(c["base_color"])
    hl = util.hex_to_ass_inline(c["highlight_color"])
    base_inline = util.hex_to_ass_inline(c["base_color"])
    x = o["width"] // 2
    y = int(o["height"] * c["y_pos"])

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {o['width']}
PlayResY: {o['height']}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{c['font']},{c['font_size']},{white},{white},&H00000000,&H7F000000,-1,0,0,0,100,100,0,0,1,{c['outline']},{c['shadow']},5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    pop = r"\fscx78\fscy78\t(0,90,\fscx100\fscy100)"
    events = []
    for g in groups:
        words = g["words"]
        n = len(words)
        for j, w in enumerate(words):
            t0 = w["start"] if j else g["start"]
            t1 = words[j + 1]["start"] if j + 1 < n else g["display_end"]
            if t1 - t0 < 0.03:
                t1 = t0 + 0.03
            tags = r"{\an5\pos(%d,%d)" % (x, y)
            if j == 0:
                tags += pop + r"\fad(60,0)"
            elif j == n - 1:
                tags += r"\fad(0,40)"
            tags += "}"
            parts = []
            for k, wk in enumerate(words):
                token = _clean(wk["text"])
                if c["uppercase"]:
                    token = token.upper()
                if k == j:
                    parts.append(r"{\1c%s}%s{\1c%s}" % (hl, token, base_inline))
                else:
                    parts.append(token)
            events.append(
                f"Dialogue: 0,{util.sec_to_ass(t0)},{util.sec_to_ass(t1)},"
                f"Cap,,0,0,0,,{tags}{' '.join(parts)}")
    return header + "\n".join(events) + "\n"
