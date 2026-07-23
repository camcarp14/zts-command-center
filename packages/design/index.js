// ═══════════════════════════════════════════════════════════════════════════
// @cc/design — the ONE token source for the Command Center.
//
// Three tools live under one shell (ZTS · Clarify · Runway). They already
// shared a font stack and motion curves; this package makes that explicit and
// adds the two axes that actually differ per tool:
//
//   • MODE   — light (ZTS, Clarify) vs dark (Runway). Not just an accent swap;
//              Runway ships a dark canvas, so the base neutrals flip too.
//   • ACCENT — emerald (ZTS) / gold (Clarify) / amber (Runway).
//
// Everything is emitted TWO ways so every tool can consume one source:
//   • theme(app)   → a JS token object (for the inline-style apps: ZTS/Clarify)
//   • cssVars(app) → CSS custom properties (for Runway's class-based CSS AND
//                    for the shared @cc/ui primitives, which read var(--accent))
//
// Legacy call sites (`T.gold`, `T.green`) keep working: theme(app) folds the
// app's historical color aliases onto the canonical `accent*` keys, so moving
// an app onto this package is a near-zero-diff import swap, not a reskin.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Base: structural tokens shared by every tool, mode-independent ──────────
export const fonts = {
  fontDisplay: "'Syne', system-ui",
  fontBody: "'Inter', system-ui, sans-serif",
  fontMono: "'DM Mono', monospace",
};

export const radii = { rSm: "8px", rMd: "10px", rLg: "14px", rPill: "999px" };

// Motion vocabulary — identical curves across all three so they feel like one
// product. Exposed both as JS (M) and CSS vars (--ease-*, --dur-*).
export const M = {
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeSpring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  easeStd: "cubic-bezier(0.4, 0, 0.2, 1)",
  durFast: "0.12s",
  durBase: "0.2s",
  durSlow: "0.32s",
};

// ─── Per-tool palettes ───────────────────────────────────────────────────────
// Each entry is a full palette: base mode + neutrals + an accent ramp + the
// semantic signals + that tool's legacy alias keys. Values transcribed from the
// three live apps so migrating an app in is faithful, not approximate.
const EMERALD = {
  accent: "#0E9F6E", accentHi: "#12B886", accentDeep: "#0A7A54",
  accentGrad: "linear-gradient(135deg, #12B886 0%, #0A7A54 100%)",
  accentSoft: "rgba(14,159,110,0.08)", accentLine: "rgba(14,159,110,0.22)",
  accentInk: "#06281C", focusRing: "0 0 0 3px rgba(14,159,110,0.32)",
};
// Clarify's "brass on midnight" — the app runs a dark navy canvas now (it
// migrated off the light gold theme), so the accent is the brighter dark-tuned
// brass and the neutrals are navy, not white.
const BRASS = {
  accent: "#C9A557", accentHi: "#E3C27E", accentDeep: "#8F7434",
  accentGrad: "linear-gradient(135deg, #E3C27E 0%, #A9853C 100%)",
  accentSoft: "rgba(201,165,87,0.12)", accentLine: "rgba(201,165,87,0.30)",
  accentInk: "#151005", focusRing: "0 0 0 3px rgba(201,165,87,0.34)",
};
const AMBER = {
  accent: "#FFB224", accentHi: "#FFC155", accentDeep: "#E09000",
  accentGrad: "linear-gradient(135deg, #FFC155 0%, #E09000 100%)",
  accentSoft: "rgba(255,178,36,0.14)", accentLine: "rgba(255,178,36,0.35)",
  accentInk: "#1A1204", focusRing: "0 0 0 3px rgba(255,178,36,0.34)",
};

// Light neutrals — ZTS and Clarify share this exact canvas.
const LIGHT = {
  mode: "light",
  bg: "#F4F5F8", surface: "#FFFFFF", surface2: "#F8FAFC", subtle: "#F8FAFC",
  ink: "#0F172A", inkDeep: "#0B1220", muted: "#64748B", faint: "#94A3B8",
  ghost: "#8A97A8", placeholder: "#9AA6B6",
  line: "rgba(0,0,0,0.08)", lineSoft: "rgba(0,0,0,0.06)", lineInk: "rgba(15,23,42,0.06)",
  good: "#059669", goodHi: "#10B981", info: "#3B82F6", warn: "#D97706", warnHi: "#F59E0B",
  bad: "#DC2626", pink: "#EC4899",
  shadowCard: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.04), 0 0 0 1px rgba(15,23,42,0.025)",
  shadowTab: "0 1px 2px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.06)",
  shadowPopover: "0 8px 24px rgba(15,23,42,0.1), 0 2px 8px rgba(15,23,42,0.06), 0 0 0 1px rgba(15,23,42,0.05)",
  shadowModal: "0 32px 80px rgba(15,23,42,0.22), 0 8px 24px rgba(15,23,42,0.12)",
};

// Dark neutrals — Runway's canvas.
const DARK = {
  mode: "dark",
  bg: "#0B0D12", surface: "#12151D", surface2: "#181D29", subtle: "#0E1118",
  ink: "#E9E7E0", inkDeep: "#FFFFFF", muted: "#9AA1AE", faint: "#667085",
  ghost: "#667085", placeholder: "#667085",
  line: "rgba(255,255,255,0.08)", lineSoft: "rgba(255,255,255,0.06)", lineStrong: "rgba(255,255,255,0.16)",
  lineInk: "rgba(255,255,255,0.08)",
  good: "#4FD694", goodHi: "#4FD694", info: "#6AA9FF", warn: "#FFB224", warnHi: "#FFC155",
  bad: "#FF6F6F", pink: "#EC4899",
  shadowCard: "0 1px 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.35)",
  shadowTab: "0 1px 2px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.4)",
  shadowPopover: "0 8px 24px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)",
  shadowModal: "0 18px 60px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.45)",
};

// Historical alias keys per app, so existing call sites keep resolving after
// the import swaps to @cc/design. Mapped onto the app's accent ramp.
const aliasFor = (a, ramp) => {
  if (a === "zts") return { green: ramp.accent, greenHi: ramp.accentHi, greenDeep: ramp.accentDeep, greenGrad: ramp.accentGrad };
  if (a === "clarify") return { gold: ramp.accent, goldHi: ramp.accentHi, goldDeep: ramp.accentDeep, goldGrad: ramp.accentGrad, goldSoft: ramp.accentSoft, goldLine: ramp.accentLine };
  return {};
};

// Clarify's exact navy neutrals (transcribed from its theme.js), distinct from
// Runway's near-black dark.
const CLARIFY_DARK = {
  mode: "dark",
  bg: "#0B0F1A", surface: "#141B2C", surface2: "#1B2438", subtle: "#0F1626",
  ink: "#E9EDF5", inkDeep: "#F7F9FC", muted: "#94A1B5", faint: "#66738A",
  ghost: "#525E74", placeholder: "#5A6780",
  line: "rgba(255,255,255,0.085)", lineSoft: "rgba(255,255,255,0.055)", lineStrong: "rgba(255,255,255,0.16)", lineInk: "rgba(255,255,255,0.07)",
  good: "#3ECF8E", goodHi: "#5EE0A8", info: "#6EA8FE", warn: "#F5B84D", warnHi: "#FFC96B", bad: "#F87171", pink: "#F472B6",
  shadowCard: "0 1px 2px rgba(0,0,0,0.5), 0 8px 30px rgba(0,0,0,0.4)",
  shadowTab: "0 1px 2px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.45)",
  shadowPopover: "0 10px 30px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.45)",
  shadowModal: "0 24px 70px rgba(0,0,0,0.65), 0 8px 24px rgba(0,0,0,0.5)",
};

const APP_DEF = {
  zts: { base: LIGHT, ramp: EMERALD, label: "ZTS", brand: "Zero To Secure" },
  clarify: { base: CLARIFY_DARK, ramp: BRASS, label: "Clarify", brand: "Clarify Outreach" },
  runway: { base: DARK, ramp: AMBER, label: "Runway", brand: "Runway" },
};

export const APPS = ["zts", "clarify", "runway"];
export const appMeta = (app) => {
  const d = APP_DEF[app] || APP_DEF.zts;
  return { app, label: d.label, brand: d.brand, mode: d.base.mode, accent: d.ramp.accent };
};

// ─── theme(app) — the JS token object for inline-style apps ──────────────────
// Shape matches the apps' existing `T` object, so `import { T } from "./theme"`
// becomes `const T = theme("zts")` with the same keys available downstream.
export function theme(app = "zts") {
  const d = APP_DEF[app] || APP_DEF.zts;
  return { ...fonts, ...radii, ...d.base, ...d.ramp, ...aliasFor(app, d.ramp), app, M };
}

// ─── cssVars(app) — CSS custom properties for class-based CSS + @cc/ui ───────
// Names cover the canonical `--accent*` set AND the exact var names Runway's
// app.css already reads, so Runway themes off this source unmodified. Apply the
// returned object as an inline `style` on each tool's mount container (the shell
// does this on app switch), or serialize with cssVarsText() for a stylesheet.
export function cssVars(app = "zts") {
  const t = theme(app);
  return {
    "--bg": t.bg,
    "--surface": t.surface,
    "--surface-2": t.surface2,
    "--subtle": t.subtle,
    "--text": t.ink,
    "--ink": t.ink,
    "--dim": t.muted,
    "--muted": t.muted,
    "--faint": t.faint,
    "--border": t.line,
    "--border-strong": t.lineStrong || t.line,
    "--accent": t.accent,
    "--accent-hi": t.accentHi,
    "--accent-deep": t.accentDeep,
    "--accent-grad": t.accentGrad,
    "--accent-soft": t.accentSoft,
    "--accent-line": t.accentLine,
    "--accent-ink": t.accentInk,
    "--good": t.good,
    "--good-soft": t.mode === "dark" ? "rgba(79,214,148,0.13)" : "rgba(5,150,105,0.10)",
    "--bad": t.bad,
    "--bad-soft": t.mode === "dark" ? "rgba(255,111,111,0.12)" : "rgba(220,38,38,0.08)",
    "--info": t.info,
    "--shadow-card": t.shadowCard,
    "--shadow-tab": t.shadowTab,
    "--shadow-popover": t.shadowPopover,
    "--shadow-modal": t.shadowModal,
    "--radius": radii.rMd,
    "--radius-lg": radii.rLg,
    "--font-display": fonts.fontDisplay,
    "--font-body": fonts.fontBody,
    "--font-mono": fonts.fontMono,
    "--dur-1": M.durFast,
    "--dur-2": M.durBase,
    "--dur-3": M.durSlow,
    "--ease-out": M.easeOut,
    "--ease-spring": M.easeSpring,
    "--focus-ring": t.focusRing,
  };
}

// Serialize cssVars(app) into a CSS declaration body (no selector), e.g. for a
// `[data-app="runway"] { … }` rule or a mount container's style attribute.
export function cssVarsText(app = "zts") {
  const v = cssVars(app);
  return Object.entries(v).map(([k, val]) => `${k}: ${val};`).join(" ");
}

// ─── Shared style fragments — spread, then override locally ──────────────────
// Mode-aware so a card reads correctly on both the light and dark canvases.
export function fragments(app = "zts") {
  const t = theme(app);
  return {
    card: { background: t.surface, borderRadius: radii.rLg, border: `1px solid ${t.lineInk}`, boxShadow: t.shadowCard },
    sectionLabel: { fontSize: "11px", fontWeight: 700, color: t.muted, textTransform: "uppercase", letterSpacing: "0.14em", fontFamily: fonts.fontDisplay },
    inputBase: { width: "100%", padding: "10px 14px", background: t.subtle, border: `1px solid ${t.line}`, borderRadius: radii.rSm, fontSize: "14px", color: t.ink, outline: "none", boxSizing: "border-box" },
    selectBase: { background: t.subtle, border: `1px solid ${t.line}`, borderRadius: radii.rSm, padding: "6px 10px", fontSize: "11px", color: t.muted, cursor: "pointer", outline: "none", fontFamily: fonts.fontBody },
  };
}

// One severity vocabulary shared across tools.
export function severity(app = "zts") {
  const t = theme(app);
  return { critical: t.bad, warning: t.warn, info: t.muted, pass: t.good };
}
