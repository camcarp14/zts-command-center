# V2 roadmap — sequenced by ROI, with implementation sketches

Ship V1, publish 10–15 Shorts, then build these in roughly this order. Each entry says what it is, why it earns its slot, and how to build it into the existing architecture.

## 1. Multiple Shorts per raw video  (highest ROI, ~1 evening)
The selector already returns 2–3 scored candidates; today you use one. Add `runall` to the CLI: for each candidate, create a sub-lineage (`work/<clip_id>/...` or clone the project per candidate) and run cut→captions→popups→draft. One filming session → 3 drafts to review. Almost all the code exists; it's a loop and a paths refactor. Do this first.

## 2. Content-type templates  (~1 evening)
A template = a named settings overlay + prompt addendum: `templates/myth_bust.yaml`, `templates/product_demo.yaml`, `templates/destruction_test.yaml` — each tweaking clip length, caption energy, pop-up budget, and injecting extra selection guidance ("for destruction tests, the payoff is the reveal frame; end within 1.5s of it"). `new --template myth_bust` merges it into the project's `overrides.yaml`. Repeatability is where a personal pipeline compounds; this is how.

## 3. Brand styling pass  (~1–2 evenings)
End-card CTA template (last 2.5s: logo PNG + one line, reuse the overlay machinery), a subtle intro accent (2-frame brand-color flash or corner logo watermark for finals), caption style presets (`captions.preset: bold_center | clean_lower`), and a locked hex palette in settings. Cheap consistency signal across the channel grid.

## 4. Smoothed tracking crop  (~2 evenings, do after 10+ publishes)
Replace the static crop: sample face x-position every 0.5s (existing OpenCV path), fit a smoothed curve (moving average + max-velocity clamp so it never whips), render with a per-segment animated `crop` x expression or piecewise segments. Only worth it once you're filming with movement; talking-head content doesn't need it.

## 5. B-roll insertion — semi-auto, from YOUR library only  (~2–3 evenings)
Build `assets/broll/manifest.json` (clip path, tags, duration) from your own product/macro footage. The popups prompt already suggests b-roll moments; extend it to also pick from the manifest by tag. Insertion = cutaway: replace video (keep voice audio) for 1.5–2.5s via the EDL — an `edl.json` extension `{"broll": [{"t":6.0,"clip":"stamp_macro.mp4","dur":2.0}]}` and a render-stage splice.
**Deliberately NOT auto stock footage:** generic stock b-roll is the fastest way to look like every other faceless channel — the opposite of the trust ZTS content needs to build. Your macro product shots are a moat; stock is anti-moat.

## 6. Curated icon/graphic library  (~1 evening, low priority)
Extend `assets/graphics/manifest.json` with tags (`fire`, `shield`, `bitcoin`, `x-mark`) over 15–20 icons you choose once for style consistency (one set, one weight — e.g., Lucide exports recolored to brand). The popups prompt gains "pick by tag."
**Deliberately NOT auto-fetching icons:** mixed icon styles read as cheap instantly, and V1's text pills + arrows + circles + your product PNGs already cover ~90% of what educational Shorts need. Challenge yourself before building this: has a draft ever actually felt worse for lacking an icon?

## 7. Advanced motion graphics  (build last, if ever)
Animated counters, progress bars, kinetic type. Two honest paths: (a) per-frame PNG sequences from Pillow — same overlay machinery, `-framerate` image2 inputs, no new deps; (b) Remotion (React-based renders) for real motion design at the cost of a Node toolchain. Before building either, watch your top 5 performing Shorts and check whether a single one was carried by motion graphics rather than hook + pacing + captions. Expected answer: no. This is bottom of the list for a reason.

## Explicitly rejected
- **Auto-publish to YouTube:** the human approval gate is the product. Uploading is 60 seconds; a compromised or buggy auto-publisher is a channel strike.
- **Custom thumbnail rendering:** the Shorts feed largely ignores custom thumbnails. The packaging stage gives you a concept for the channel-grid frame; spending render engineering here is negative ROI.
- **Music/SFX auto-selection:** licensing risk + taste-sensitive. Add music manually in YouTube's editor or drop a licensed track into the final render by hand if a video needs it.
