// ─── ZTS palette — one source of truth, derived from @cc/design ──────────────
// ZTS now runs on the shared "midnight" canvas (the same dark base as Clarify
// and Runway); its only distinguishing mark is the emerald accent. These keys
// keep ZTS's historical names (card, sub, navy, amber, cardShadow…) so every
// inline style across the app resolves unchanged — it just renders dark now.
import { theme, M } from "@cc/design";

const t = theme("zts"); // midnight base + emerald ramp (+ green* legacy aliases)

export const T = {
  ...t,
  bg: "transparent", // the body background is painted in useGlobalStyles
  // legacy ZTS key names → canonical midnight tokens
  sub: t.muted,
  faint: t.faint,
  card: t.surface,
  line: t.line,
  cardShadow: t.shadowCard,
  navy: t.surface2, // a raised dark panel (was a deep navy on the old light theme)
  navyGrad: "linear-gradient(135deg, #1B2438 0%, #0F1626 100%)",
  amber: t.warn, // secondary warm accent (stage labels, insights)
  amberDeep: "#E0A94A",
  blue: t.info,
  red: t.bad,
  purple: "#A78BFA",
  // t already carries: ink, green, greenDeep, greenGrad, accent, accentInk, accentSoft…
};

// Display / mono fonts as standalone consts (App.jsx references them directly).
export const syne = "'Syne', system-ui";
export const mono = "'DM Mono', monospace";

export { M };
