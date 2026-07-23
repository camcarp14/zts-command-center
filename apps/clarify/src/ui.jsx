// ─── Shared UI primitives — the "feel" layer ──────────────────────────────────
// Motion, empty states, skeletons, toasts, and the command palette. Everything
// here is additive: import what a view needs, nothing here reaches into
// business logic. Kept out of App.jsx purely to stop that file from growing
// further — same design tokens, same conventions.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { T } from "./theme";

const reduceMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ─── AnimatedNumber — count from its previous value to the next one. Used for
// every headline stat so the app feels like it's actually computing, not just
// re-rendering text. Falls back to an instant jump under reduced-motion. ──────
export function AnimatedNumber({ value, format, duration = 700, style }) {
  const numeric = typeof value === "number" && !Number.isNaN(value) ? value : 0;
  const [display, setDisplay] = useState(numeric);
  const fromRef = useRef(numeric);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = numeric;
    if (from === to) return;
    if (reduceMotion()) { setDisplay(to); fromRef.current = to; return; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeric, duration]);

  return <span style={style}>{format ? format(display) : Math.round(display)}</span>;
}

// ─── Skeletons — shimmer blocks that reuse the app's own @keyframes shimmer
// (injected globally by App()). Shapes mimic the silhouette of what's loading
// so the transition to real content doesn't jump around. ─────────────────────
const shimmerStyle = (extra) => ({
  background: "linear-gradient(90deg, rgba(255,255,255,0.045) 25%, rgba(255,255,255,0.09) 37%, rgba(255,255,255,0.045) 63%)",
  backgroundSize: "400% 100%",
  animation: "shimmer 1.6s ease-in-out infinite",
  ...extra,
});

export function SkeletonLine({ width = "100%", height = "11px", style }) {
  return <div style={shimmerStyle({ width, height, borderRadius: "5px", ...style })} />;
}

export function SkeletonBlock({ width = "100%", height = "80px", radius = T.rLg, style }) {
  return <div style={shimmerStyle({ width, height, borderRadius: radius, ...style })} />;
}

// A generic card-shaped skeleton — header line + two body lines + footer pill.
export function SkeletonCard({ style }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.lineInk}`, borderRadius: "11px", padding: "14px 16px", ...style }}>
      <SkeletonLine width="55%" height="13px" style={{ marginBottom: "10px" }} />
      <SkeletonLine width="85%" style={{ marginBottom: "6px" }} />
      <SkeletonLine width="40%" />
    </div>
  );
}

export function SkeletonRows({ count = 3, cardStyle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} style={{ ...cardStyle, opacity: 1 - i * 0.14 }} />)}
    </div>
  );
}

// ─── Empty-state iconography — hand-drawn line icons, no dependency, brand
// stroke color by default (inherits currentColor so callers can tint it). ─────
const ICONS = {
  inbox: "M4 12l2.5-7A2 2 0 0 1 8.4 3.5h7.2a2 2 0 0 1 1.9 1.5L20 12M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M4 12h4.5a1 1 0 0 1 .95.68L10 15h4l.55-2.32a1 1 0 0 1 .95-.68H20",
  users: "M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 20c.6-3.2 3-5.5 6-5.5s5.4 2.3 6 5.5M16 11a2.5 2.5 0 1 0 0-5M17.5 14.5c2.3.4 4 2.3 4.5 5",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  calendar: "M4 9h16M7 3v3M17 3v3M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  radar: "M12 2v4M12 2a10 10 0 1 0 7.07 2.93M12 8a4 4 0 1 0 2.83 1.17M12 12l5-5",
  spark: "M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3Z",
  check: "M20 6 9 17l-5-5",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v10M9 9.5c0-1.1 1.3-2 3-2s3 .7 3 1.8c0 2.4-6 1.2-6 3.6 0 1.1 1.3 1.8 3 1.8s3-.9 3-2",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
};

export function EmptyIcon({ kind = "inbox", size = 26, color, style }) {
  const d = ICONS[kind] || ICONS.inbox;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <path d={d} stroke={color || "currentColor"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── EmptyState — one consistent shape for every "there's nothing here yet"
// moment in the app: icon in a soft tinted well, title, one line of context,
// optional CTA. Replaces ad-hoc emoji + gray text scattered per view. ─────────
export function EmptyState({ icon = "inbox", tint = T.gold, title, sub, action, dashed = true, compact = false, style }) {
  return (
    <div style={{
      textAlign: "center",
      padding: compact ? "28px 20px" : "52px 32px",
      borderRadius: T.rLg,
      border: dashed ? `1px dashed ${T.line}` : "none",
      background: dashed ? "rgba(255,255,255,0.02)" : "transparent",
      ...style,
    }}>
      <div style={{
        width: compact ? "34px" : "44px", height: compact ? "34px" : "44px",
        margin: "0 auto", marginBottom: compact ? "10px" : "16px",
        borderRadius: "12px", background: `${tint}12`, border: `1px solid ${tint}22`,
        display: "flex", alignItems: "center", justifyContent: "center", color: tint,
      }}>
        <EmptyIcon kind={icon} size={compact ? 16 : 20} />
      </div>
      <div style={{ fontSize: compact ? "12.5px" : "14px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay, marginBottom: sub ? "6px" : 0 }}>{title}</div>
      {sub && <div style={{ fontSize: compact ? "11.5px" : "12.5px", color: T.muted, maxWidth: "340px", margin: "0 auto", lineHeight: 1.6 }}>{sub}</div>}
      {action && <div style={{ marginTop: compact ? "12px" : "18px" }}>{action}</div>}
    </div>
  );
}

// ─── Toasts — transient confirmations, replacing scattered inline status
// banners. Stacks top-right, under the nav; each entry auto-dismisses on a
// visible countdown bar and can be dismissed early by click. ─────────────────
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 220);
  }, []);

  const push = useCallback((message, opts = {}) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const toast = { id, message, tone: opts.tone || "default", duration: opts.duration ?? 4200 };
    setToasts((t) => [...t.slice(-3), toast]);
    return id;
  }, []);

  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} dismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast() must be used inside <ToastProvider>");
  return ctx;
}

const TOAST_TONES = {
  default: { border: "rgba(255,255,255,0.14)", dot: T.ink },
  success: { border: "rgba(62,207,142,0.35)", dot: T.green },
  error: { border: "rgba(248,113,113,0.35)", dot: T.red },
  warning: { border: "rgba(245,184,77,0.35)", dot: T.amber },
};

function Toast({ toast, dismiss }) {
  const tone = TOAST_TONES[toast.tone] || TOAST_TONES.default;
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);
  return (
    <div onClick={() => dismiss(toast.id)} style={{
      position: "relative", overflow: "hidden", cursor: "pointer",
      minWidth: "260px", maxWidth: "360px",
      background: T.surface, border: `1px solid ${tone.border}`, borderRadius: T.rMd,
      boxShadow: T.shadowPopover, padding: "11px 14px",
      display: "flex", alignItems: "flex-start", gap: "10px",
      animation: `${toast.leaving ? "toastOut" : "toastIn"} ${T.durBase} ${T.easeOut} both`,
    }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: tone.dot, flexShrink: 0, marginTop: "5px" }} />
      <span style={{ fontSize: "12.5px", color: T.ink, lineHeight: 1.5, flex: 1 }}>{toast.message}</span>
      {!toast.leaving && (
        <span style={{ position: "absolute", left: 0, bottom: 0, height: "2px", background: tone.dot, opacity: 0.35, width: "100%", transformOrigin: "left", animation: `toastShrink ${toast.duration}ms linear both` }} />
      )}
    </div>
  );
}

function ToastStack({ toasts, dismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{ position: "fixed", top: "64px", right: "16px", zIndex: 600, display: "flex", flexDirection: "column", gap: "8px", pointerEvents: "none" }}>
      {toasts.map((t) => <div key={t.id} style={{ pointerEvents: "auto" }}><Toast toast={t} dismiss={dismiss} /></div>)}
    </div>
  );
}

// ─── CommandPalette — Cmd/Ctrl+K. Fuzzy-ish substring match over a flat action
// list the caller builds fresh each render (cheap — it's just tabs + cards). ──
export function CommandPalette({ open, onClose, actions }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery(""); setIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q) || (a.sub || "").toLowerCase().includes(q) || (a.keywords || "").toLowerCase().includes(q));
  }, [query, actions]);

  useEffect(() => { setIndex(0); }, [query]);

  const run = (a) => { if (!a) return; onClose(); a.run(); };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(filtered[index]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  if (!open) return null;

  return (
    // Deliberately NOT co-modal-overlay/co-modal-sheet — those classes carry
    // !important mobile rules (bottom-sheet layout) meant for confirm dialogs
    // and thread modals. A command palette should stay a spotlight dropdown on
    // every screen size, so it gets its own unstyled hooks instead.
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 700,
      display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12vh 16px 0",
      animation: `fadein ${T.durFast} ease both`,
    }}>
      <div style={{
        width: "100%", maxWidth: "560px", maxHeight: "60vh", display: "flex", flexDirection: "column",
        background: T.surface, borderRadius: "16px", overflow: "hidden", boxShadow: T.shadowModal,
        animation: `paletteIn 0.16s ${T.easeOut} both`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 18px", borderBottom: `1px solid ${T.lineInk}`, flexShrink: 0 }}>
          <span style={{ color: T.faint, display: "flex" }}><EmptyIcon kind="search" size={16} /></span>
          <input
            ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Jump to a tab, prospect, or action…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: "14px", color: T.ink, fontFamily: T.fontBody }}
          />
          <kbd style={{ fontSize: "10px", fontFamily: T.fontMono, color: T.faint, background: T.subtle, border: `1px solid ${T.line}`, borderRadius: "5px", padding: "2px 6px" }}>esc</kbd>
        </div>
        <div style={{ overflowY: "auto", padding: "8px", flex: 1 }}>
          {filtered.length === 0 ? (
            <EmptyState compact icon="search" title="No matches" sub="Try a different tab name, prospect, or action." />
          ) : filtered.map((a, i) => (
            <button key={a.id} onMouseEnter={() => setIndex(i)} onClick={() => run(a)} style={{
              width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: "12px",
              padding: "9px 10px", borderRadius: "9px", border: "none", cursor: "pointer",
              background: i === index ? T.goldSoft : "transparent",
            }}>
              <span style={{
                width: "26px", height: "26px", borderRadius: "7px", flexShrink: 0,
                background: i === index ? T.goldGrad : T.subtle, color: i === index ? T.textOnBrand : T.muted,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px",
              }}>{a.icon || "→"}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label}</div>
                {a.sub && <div style={{ fontSize: "11px", color: T.muted, marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.sub}</div>}
              </span>
              {a.group && <span style={{ fontSize: "9px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>{a.group}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "14px", padding: "9px 16px", borderTop: `1px solid ${T.lineInk}`, fontSize: "10.5px", color: T.faint, flexShrink: 0 }}>
          <span>↑↓ navigate</span><span>↵ select</span><span>esc close</span>
        </div>
      </div>
    </div>
  );
}
