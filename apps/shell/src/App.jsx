// ═══════════════════════════════════════════════════════════════════════════
// The Pentagon — the shell.
//
// One site, one login, one toggle. The shell owns exactly four things:
//   • auth (a single login gates all three tools)
//   • the top-of-screen app toggle (ZTS · Clarify · Runway · Macro), plus ⌥1-4
//   • per-tool theming (it stamps @cc/design's CSS vars on a wrapper, so
//     switching tools re-accents the whole page over the shared dark canvas)
//   • the cross-tool System hub (usage · minds · agents)
// Each tool keeps its own internal nav — and its own ⌘K palette — directly
// beneath (two clear layers), and is lazy-loaded so opening one never
// downloads the others.
// ═══════════════════════════════════════════════════════════════════════════
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { appMeta, cssVars, APPS } from "@cc/design";
import { SkeletonBoard, EmptyIcon, M, useIsMobile } from "@cc/ui";
import { auth, isConfigured } from "@cc/supabase";

// Lazily-mounted tools. Wired in per Phase-C increment; a tool without an entry
// here renders the "coming in this build" panel so the toggle always works.
const TOOLS = {
  zts: lazy(() => import("@app/zts")),
  clarify: lazy(() => import("@app/clarify")),
  runway: lazy(() => import("@app/runway")),
  macro: lazy(() => import("@app/macro")),
};

// The shell-owned cross-tool management surface (Usage / Minds / Agents).
const System = lazy(() => import("./System.jsx"));

// Neutral "platform" theme for the top bar while System is open, so the chrome
// matches System's own dark surface instead of the active tool's accent.
const PLATFORM_VARS = {
  "--bg": "#0A0E15", "--surface": "#131A24", "--ink": "#E9EDF5", "--muted": "#93A1B5",
  "--faint": "#66748A", "--border": "rgba(255,255,255,0.08)", "--accent": "#AAB6C6",
  "--accent-soft": "rgba(170,182,198,0.14)", "--shadow-tab": "0 1px 2px rgba(0,0,0,0.5)",
  "--font-display": "'Syne',system-ui", "--font-body": "'Inter',system-ui,sans-serif", "--font-mono": "'DM Mono',monospace",
};

// ─── hooks ────────────────────────────────────────────────────────────────────
function useSession() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  useEffect(() => {
    if (!isConfigured()) { setSession(null); return; }
    auth.getSession().then((s) => setSession(s || null));
    return auth.onChange((s) => setSession(s || null));
  }, []);
  return session;
}

// ─── boot + login ─────────────────────────────────────────────────────────────
const BrandMark = ({ size = 12, gap = 4 }) => (
  <span style={{ display: "inline-flex", gap: `${gap}px`, alignItems: "center" }}>
    {APPS.map((a) => (
      <span key={a} style={{ width: `${size}px`, height: `${size}px`, borderRadius: "50%", background: appMeta(a).accent, boxShadow: `0 0 10px ${appMeta(a).accent}66` }} />
    ))}
  </span>
);

function Boot() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0d12" }}>
      <div style={{ width: 30, height: 30, border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "#FFB224", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { await auth.signIn(email.trim(), password); }
    catch (ex) { setErr(ex?.message || "Sign in failed"); setBusy(false); }
  };
  const field = { width: "100%", padding: "11px 13px", background: "#0e1118", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 9, color: "#e9e7e0", fontSize: 14, outline: "none", fontFamily: "'Inter',system-ui" };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "radial-gradient(1200px 600px at 50% -10%, #171b26 0%, #0b0d12 60%)", padding: 20 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360, background: "#12151d", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: "30px 26px", boxShadow: "0 24px 70px rgba(0,0,0,0.55)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <BrandMark size={11} />
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "#e9e7e0", fontFamily: "'Syne',system-ui" }}>The Pentagon</span>
        </div>
        <div style={{ fontSize: 12.5, color: "#9aa1ae", marginBottom: 18, lineHeight: 1.6 }}>One sign-in for ZTS, Clarify, and Runway.</div>
        <label style={{ fontSize: 11, color: "#9aa1ae", fontWeight: 600 }}>Email</label>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...field, margin: "6px 0 14px" }} />
        <label style={{ fontSize: 11, color: "#9aa1ae", fontWeight: 600 }}>Password</label>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...field, margin: "6px 0 4px" }} />
        {err && <div style={{ color: "#ff6f6f", fontSize: 12, marginTop: 10 }}>{err}</div>}
        {!isConfigured() && <div style={{ color: "#FFB224", fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>Supabase isn't configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</div>}
        <button type="submit" disabled={busy} style={{ width: "100%", marginTop: 18, padding: "11px", borderRadius: 9, border: "none", cursor: busy ? "default" : "pointer", background: "linear-gradient(135deg,#FFC155,#E09000)", color: "#1a1204", fontWeight: 800, fontSize: 13.5, fontFamily: "'Syne',system-ui", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

// ─── the app toggle ───────────────────────────────────────────────────────────
function AppToggle({ active, onPick, compact }) {
  const refs = useRef({});
  const [ind, setInd] = useState({ left: 0, width: 0, ready: false });
  // Measure the active button so the white pill glides between tools instead of
  // teleporting. Re-measures on tool switch and on the mobile/desktop flip.
  useLayoutEffect(() => {
    const el = refs.current[active];
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
  }, [active, compact]);
  return (
    <div style={{ position: "relative", display: "inline-flex", gap: 2, padding: 3, borderRadius: 11, background: "color-mix(in srgb, var(--ink) 6%, transparent)", border: "1px solid var(--border)" }}>
      {ind.ready && (
        <div style={{ position: "absolute", top: 3, bottom: 3, left: ind.left, width: ind.width, background: "var(--surface)", borderRadius: 8, boxShadow: "var(--shadow-tab)", transition: `left ${M.durBase} ${M.easeSpring}, width ${M.durBase} ${M.easeSpring}` }} />
      )}
      {APPS.map((a) => {
        const m = appMeta(a);
        const on = a === active;
        // On mobile the toggle is dots-only to save room, but the ACTIVE tool
        // keeps its label so you always know where you are.
        const showLabel = !compact || on;
        return (
          <button key={a} ref={(el) => { refs.current[a] = el; }} onClick={() => onPick(a)} title={m.label} style={{
            position: "relative", zIndex: 1,
            display: "inline-flex", alignItems: "center", gap: 7, padding: compact ? "6px 10px" : "6px 14px",
            border: "none", borderRadius: 8, cursor: "pointer", background: "transparent",
            color: on ? "var(--ink)" : "var(--faint)",
            fontFamily: "'Syne',system-ui", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            transition: `color ${M.durBase} ${M.easeStd}`,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: m.accent, boxShadow: on ? `0 0 8px ${m.accent}` : "none", flexShrink: 0 }} />
            {showLabel && m.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── the panel for a not-yet-mounted tool ───────────────────────────────────
function ComingSoon({ app }) {
  const m = appMeta(app);
  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 380 }}>
        <div style={{ width: 52, height: 52, margin: "0 auto 16px", borderRadius: 14, background: "var(--accent-soft)", border: "1px solid var(--accent-line)", display: "grid", placeItems: "center", color: "var(--accent)" }}>
          <EmptyIcon kind="spark" size={22} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Syne',system-ui", color: "var(--ink)", marginBottom: 8 }}>{m.brand}</div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Getting mounted into The Pentagon. The toggle, theme, and one-login are already wired — this tool comes online in the next build increment.
        </div>
      </div>
    </div>
  );
}

// ─── shell ────────────────────────────────────────────────────────────────────
export default function Shell() {
  const session = useSession();
  const isMobile = useIsMobile();
  const [active, setActive] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem("cc_active_app")) || "zts");
  const [systemOpen, setSystemOpen] = useState(false);

  const pick = useCallback((a) => {
    setActive(a);
    setSystemOpen(false);
    try { localStorage.setItem("cc_active_app", a); } catch {}
  }, []);

  // ⌥1 / ⌥2 / ⌥3 / ⌥4 jump between tools. Deliberately NOT ⌘K — each tool owns its
  // own (richer) ⌘K palette, and Option+number never collides with the browser.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      // Match e.code, not e.key: on macOS, Option composes the digit into a glyph
      // (⌥1 → "¡"), so e.key is never "1"/"2"/"3" and the shortcut would silently
      // do nothing. e.code stays "Digit1".."Digit3" regardless of the modifier.
      const i = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      if (i === -1 || !APPS[i]) return;
      e.preventDefault();
      pick(APPS[i]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick]);

  if (session === undefined) return <Boot />;
  if (!session) return <LoginScreen />;

  const m = appMeta(active);
  const Tool = TOOLS[active];

  return (
    <div data-app={systemOpen ? "system" : active} data-theme={systemOpen ? "dark" : m.mode} style={{ ...(systemOpen ? PLATFORM_VARS : cssVars(active)), minHeight: "100vh", background: "var(--bg)", color: "var(--ink)", fontFamily: "var(--font-body)", transition: `background ${M.durSlow} ${M.easeStd}` }}>
      {/* Shell top bar — the ONE global chrome, themed to the active tool */}
      <div style={{
        position: "sticky", top: 0, zIndex: 100, height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: isMobile ? "0 12px" : "0 20px", borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--bg) 82%, transparent)", backdropFilter: "blur(20px) saturate(140%)", WebkitBackdropFilter: "blur(20px) saturate(140%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          {!isMobile && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <BrandMark size={9} />
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink)", fontFamily: "'Syne',system-ui", whiteSpace: "nowrap" }}>The Pentagon</span>
            </span>
          )}
          <AppToggle active={active} onPick={pick} compact={isMobile} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setSystemOpen((o) => !o)} title="System — usage, minds & agents across every tool" style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: systemOpen ? "var(--accent-soft)" : "none", border: "1px solid var(--border)", borderRadius: 7,
            color: systemOpen ? "var(--ink)" : "var(--muted)", fontSize: 10.5, padding: "5px 10px", cursor: "pointer",
            fontWeight: 700, fontFamily: "'Syne',system-ui", letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: systemOpen ? "var(--ink)" : "var(--faint)" }} />System
          </button>
          {!isMobile && (
            <button onClick={() => auth.signOut()} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7, color: "var(--muted)", fontSize: 10, padding: "5px 10px", cursor: "pointer", fontWeight: 600, fontFamily: "'Syne',system-ui" }}>Sign out</button>
          )}
        </div>
      </div>

      {/* System hub (cross-tool) or the active tool, both lazy-loaded */}
      <Suspense fallback={<div style={{ padding: 24 }}><SkeletonBoard /></div>}>
        {systemOpen
          ? <System onExit={() => setSystemOpen(false)} onOpenTool={pick} />
          : Tool ? <Tool key={active} /> : <ComingSoon app={active} />}
      </Suspense>
    </div>
  );
}
