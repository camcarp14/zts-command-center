// ─── ZTS design tokens ─────────────────────────────────────────────────────
// This file is IDENTICAL to clarify-outreach/src/theme.js on purpose.
// ZTS Command Center and Clarify Outreach are both "business ops tool" apps
// under the same visual family, and their colors had already converged
// independently (same #B68A2E gold, same #F4F5F8 canvas, same Syne/Inter/
// DM Mono font stack) before this file existed. Rather than invent a third
// variant, ZTS now imports the same values Clarify already proved out.
//
// If you deliberately want ZTS to diverge from Clarify visually in the
// future, do it here — but that's a decision to make on purpose, not by
// two files quietly drifting apart. See PLATFORM-STANDARDS.md.
//
// Board Room does NOT share this file — it's a distinct personal-app
// aesthetic (bronze/Roman) and has its own theme.js with the same shape.

export const T = {
  // brand
  gold: "#B68A2E",
  goldHi: "#C8A04A",
  goldDeep: "#A87C2E",
  goldGrad: "linear-gradient(135deg, #C8A04A 0%, #A87C2E 100%)",
  goldSoft: "rgba(184,145,58,0.07)",
  goldLine: "rgba(184,145,58,0.22)",

  // ink & text
  ink: "#0F172A",
  inkDeep: "#0B1220",
  inkBrand: "#1A1206",
  muted: "#64748B",
  faint: "#94A3B8",
  ghost: "#8A97A8",
  placeholder: "#9AA6B6",

  // canvas
  bg: "#F4F5F8",
  surface: "#FFFFFF",
  subtle: "#F8FAFC",
  line: "rgba(0,0,0,0.08)",
  lineSoft: "rgba(0,0,0,0.06)",
  lineInk: "rgba(15,23,42,0.06)",

  // signals
  pink: "#EC4899",
  blue: "#3B82F6",
  blueDeep: "#2563EB",
  red: "#DC2626",
  amber: "#D97706",
  amberHi: "#F59E0B",
  green: "#059669",
  greenHi: "#10B981",

  // type
  fontDisplay: "'Syne', system-ui",
  fontBody: "'Inter', system-ui, sans-serif",
  fontMono: "'DM Mono', monospace",

  // radii
  rSm: "8px",
  rMd: "10px",
  rLg: "14px",
  rPill: "999px",

  // shadows
  shadowCard: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.04), 0 0 0 1px rgba(15,23,42,0.025)",
  shadowTab: "0 1px 2px rgba(15,23,42,0.08), 0 2px 6px rgba(15,23,42,0.06)",
  focusRing: "0 0 0 3px rgba(184,145,58,0.32)",
};

// ── Shared style fragments — spread these, then override locally as needed ──
export const card = {
  background: T.surface,
  borderRadius: T.rLg,
  border: `1px solid ${T.lineInk}`,
  boxShadow: T.shadowCard,
};

export const sectionLabel = {
  fontSize: "11px",
  fontWeight: 700,
  color: T.muted,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  fontFamily: T.fontDisplay,
};

export const inputBase = {
  width: "100%",
  padding: "10px 14px",
  background: T.subtle,
  border: "1px solid rgba(0,0,0,0.1)",
  borderRadius: T.rSm,
  fontSize: "14px",
  color: T.ink,
  outline: "none",
  boxSizing: "border-box",
};

export const selectBase = {
  background: T.subtle,
  border: "1px solid rgba(0,0,0,0.09)",
  borderRadius: T.rSm,
  padding: "6px 10px",
  fontSize: "11px",
  color: T.muted,
  cursor: "pointer",
  outline: "none",
  fontFamily: T.fontBody,
};

// One severity vocabulary — reads the same as Clarify's for the same meanings.
export const SEV = {
  critical: T.red,
  warning: T.amber,
  info: T.muted,
  pass: T.green,
};
