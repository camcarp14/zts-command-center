"""shorts-factory CLI.

Typical session:
  python -m pipeline.cli new "seed phrase myths" --video ~/footage/take1.mp4
  python -m pipeline.cli run <project>          # transcribe -> select -> draft v1
  (watch drafts/draft_v1.mp4, read drafts/REVIEW_v1.md)
  python -m pipeline.cli revise <project> "start 2s earlier, captions bigger"
  python -m pipeline.cli approve <project>
  python -m pipeline.cli export <project>
"""
import argparse
import shutil
import sys

from . import captions, cut, ingest, package, popups, render, select, transcribe, util
from .llm import ManualModeExit


def cmd_run(pdir, args):
    transcribe.transcribe(pdir, force=args.force)
    select.select(pdir, force=args.force)
    cut.cut(pdir, force=True)
    captions.build(pdir)
    popups.plan(pdir, force=args.force)
    package.build_package(pdir, force=args.force)
    draft = render.render(pdir, final=False)
    package.write_review(pdir, draft)
    v = util.load_state(pdir).get("draft_version", 1)
    print(f"\nDraft v{v} ready:\n  video:  {draft}\n"
          f"  review: {pdir}/drafts/REVIEW_v{v}.md\n"
          f'Next: revise with feedback, or approve + export.')


def cmd_export(pdir, args):
    state = util.load_state(pdir)
    v = state.get("draft_version", 0)
    if not args.skip_approval and state.get("approved_version") != v:
        sys.exit(f"Draft v{v} is not approved. Watch it, then run:\n"
                 f"  python -m pipeline.cli approve {pdir.name}\n"
                 f"(or export --skip-approval to override)")
    out = render.render(pdir, final=True)
    # Ship the packaging alongside the video.
    review = pdir / "drafts" / f"REVIEW_v{v}.md"
    if review.exists():
        shutil.copy2(review, pdir / "final" / "PACKAGE.md")
    print(f"\nFINAL EXPORT: {out}\nPackaging copy: {pdir}/final/PACKAGE.md")


def cmd_doctor(_, __):
    ok = True
    for tool in ("ffmpeg", "ffprobe"):
        found = shutil.which(tool)
        print(f"{'OK ' if found else 'MISSING'}  {tool}  {found or '-- install ffmpeg'}")
        ok = ok and bool(found)
    for mod, why in [("faster_whisper", "transcription"), ("PIL", "overlays"),
                     ("yaml", "config"), ("anthropic", "API mode (optional)"),
                     ("cv2", "auto reframing (optional)")]:
        try:
            __import__(mod)
            print(f"OK   python module {mod}")
        except ImportError:
            print(f"MISSING  python module {mod}  ({why})")
            if mod in ("faster_whisper", "PIL", "yaml"):
                ok = False
    import os
    key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    print(f"{'OK ' if key else 'INFO'}  ANTHROPIC_API_KEY "
          f"{'set' if key else 'not set -- pipeline will use manual LLM mode'}")
    fonts = list((util.ROOT / "assets/fonts").glob("*.[to]tf"))
    print(f"{'OK ' if fonts else 'WARN'}  caption font "
          f"{fonts[0].name if fonts else 'none in assets/fonts (see GET_FONTS.md)'}")
    sys.exit(0 if ok else 1)


def main():
    ap = argparse.ArgumentParser(prog="shorts-factory")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_new = sub.add_parser("new", help="create a project from raw footage")
    p_new.add_argument("name")
    p_new.add_argument("--video", action="append", required=True,
                       help="path to raw footage (repeat for multiple files)")

    for name, hlp in [("run", "full pipeline -> draft v1"),
                      ("transcribe", "just transcription"),
                      ("select", "just clip candidates"),
                      ("cut", "tighten + rough cut"),
                      ("captions", "rebuild captions"),
                      ("popups", "plan + render pop-ups"),
                      ("package", "titles/description/etc"),
                      ("draft", "re-render current draft"),
                      ("review", "print latest review doc"),
                      ("approve", "approve latest draft for export"),
                      ("export", "final MP4 (requires approval)")]:
        sp = sub.add_parser(name, help=hlp)
        sp.add_argument("project")
        sp.add_argument("--force", action="store_true")
        if name == "export":
            sp.add_argument("--skip-approval", action="store_true")

    p_choose = sub.add_parser("choose", help="switch candidate clip")
    p_choose.add_argument("project")
    p_choose.add_argument("clip_id")

    p_rev = sub.add_parser("revise", help="plain-English feedback -> new draft")
    p_rev.add_argument("project")
    p_rev.add_argument("feedback")

    sub.add_parser("doctor", help="check environment")

    args = ap.parse_args()
    try:
        if args.cmd == "new":
            ingest.new_project(args.name, args.video)
            return
        if args.cmd == "doctor":
            cmd_doctor(None, None)
            return

        pdir = util.project_dir(args.project)
        if args.cmd == "run":
            cmd_run(pdir, args)
        elif args.cmd == "transcribe":
            transcribe.transcribe(pdir, force=args.force)
        elif args.cmd == "select":
            select.select(pdir, force=args.force)
        elif args.cmd == "choose":
            select.choose(pdir, args.clip_id)
        elif args.cmd == "cut":
            cut.cut(pdir, force=True)
            captions.build(pdir)
        elif args.cmd == "captions":
            captions.build(pdir)
        elif args.cmd == "popups":
            popups.plan(pdir, force=args.force)
        elif args.cmd == "package":
            package.build_package(pdir, force=args.force)
        elif args.cmd == "draft":
            draft = render.render(pdir, final=False)
            package.write_review(pdir, draft)
        elif args.cmd == "review":
            v = util.load_state(pdir).get("draft_version", 1)
            f = pdir / "drafts" / f"REVIEW_v{v}.md"
            print(f.read_text() if f.exists() else "No review yet -- run the pipeline.")
        elif args.cmd == "revise":
            from . import revise as revise_mod
            revise_mod.revise(pdir, args.feedback)
        elif args.cmd == "approve":
            v = util.load_state(pdir).get("draft_version", 0)
            util.save_state(pdir, approved_version=v)
            print(f"Approved draft v{v}. Export with: "
                  f"python -m pipeline.cli export {pdir.name}")
        elif args.cmd == "export":
            cmd_export(pdir, args)
    except ManualModeExit:
        raise
    except RuntimeError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
