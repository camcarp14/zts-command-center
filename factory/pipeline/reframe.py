"""9:16 crop computation.

V1 uses ONE static crop for the whole clip:
  - mode=auto:   sample frames from the chosen window, detect faces (OpenCV
                 Haar cascade), center the crop on the median face position.
  - mode=center: dead center.
  - mode=offset: manual horizontal position via reframe.offset_x (0..1).

A static crop is deliberate for V1 — per-frame tracking crops look great when
they work and seasick when they don't. V2 upgrades this to smoothed tracking.
"""
import tempfile
from pathlib import Path

from . import util


def compute_crop(raw: Path, window: list, settings: dict, state: dict) -> dict:
    w, h = state["width"], state["height"]
    target = 9 / 16
    mode = settings["reframe"]["mode"]

    if w / h > target:          # source wider than 9:16 (typical landscape)
        ch, cw = h, util.even(h * target)
        y = 0
        cx = _auto_center_x(raw, window, settings, w) if mode == "auto" else None
        if cx is None:
            cx = w * (settings["reframe"]["offset_x"] if mode == "offset" else 0.5)
        x = int(min(max(cx - cw / 2, 0), w - cw))
    else:                        # already 9:16 or taller
        cw, ch = w, min(h, util.even(w / target))
        x, y = 0, int((h - ch) / 2)

    crop = {"w": cw, "h": ch, "x": x, "y": y}
    print(f"Crop: {cw}x{ch} at ({x},{y}) from {w}x{h}  [mode={mode}]")
    return crop


def _auto_center_x(raw: Path, window: list, settings: dict, src_w: int):
    try:
        import cv2
        import numpy as np
    except ImportError:
        print("OpenCV not installed -- falling back to center crop "
              "(pip install opencv-python-headless for auto framing).")
        return None

    ws, we = window
    n = settings["reframe"]["samples"]
    times = [ws + (we - ws) * (i + 1) / (n + 1) for i in range(n)]
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    centers = []
    with tempfile.TemporaryDirectory() as td:
        for i, t in enumerate(times):
            frame = Path(td) / f"f{i}.jpg"
            try:
                util.run(["ffmpeg", "-y", "-ss", f"{t:.2f}", "-i", raw,
                          "-frames:v", "1", "-q:v", "3", frame])
            except RuntimeError:
                continue
            img = cv2.imread(str(frame))
            if img is None:
                continue
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, 1.15, 5, minSize=(60, 60))
            if len(faces):
                fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
                centers.append(fx + fw / 2)

    if not centers:
        print("No faces detected in sampled frames -- using center crop.")
        return None
    centers.sort()
    return float(centers[len(centers) // 2])


def crop_vf(crop: dict, settings: dict) -> str:
    o = settings["output"]
    return (f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']},"
            f"scale={o['width']}:{o['height']}:flags=lanczos,fps={o['fps']}")
