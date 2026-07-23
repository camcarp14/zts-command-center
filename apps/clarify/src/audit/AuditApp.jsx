// ─── Free audit — public lead-gen page (own Vite entry, no auth code) ────────
// Brand-continuous with the app: brass on midnight, Syne display. The page's
// one job: convert a visit into an email + a run. The signature moment is the
// score ring drawing itself when results land. Copy stays honest — the report
// renders right here; the email is how Cameron follows up.
import { useEffect, useRef, useState } from "react";
import { T, SEV } from "../theme.js";
import { SCHEDULING_LINK, SCHEDULING_LINK_CONFIGURED } from "../config.js";

// Severity colors come from the app-wide SEV vocabulary (theme.js) — the
// public page must read the same colors for the same meanings as the product.
const STATUS_META = {
  pass: { icon: "✓", label: "Good", color: SEV.pass },
  warn: { icon: "!", label: "Needs attention", color: SEV.warning },
  fail: { icon: "✕", label: "Costing you", color: SEV.critical },
};

function useInjectGlobalCss() {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      html, body { margin: 0; font-family: 'Inter', system-ui, sans-serif; }
      body {
        background-color: ${T.bg};
        background-image:
          radial-gradient(1100px 560px at 14% -6%, rgba(201,165,87,0.08), transparent 60%),
          radial-gradient(900px 640px at 100% 0%, rgba(110,168,254,0.05), transparent 55%);
        background-attachment: fixed;
        color-scheme: dark;
      }
      * { -webkit-font-smoothing: antialiased; }
      ::selection { background: rgba(201,165,87,0.32); color: ${T.inkDeep}; }
      input::placeholder { color: ${T.placeholder}; }
      button, input { font-family: 'Inter', system-ui, sans-serif; transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease, transform 0.12s ease, opacity 0.16s ease; }
      button:not(:disabled):active { transform: translateY(0.5px); }
      button:focus-visible, input:focus-visible, a:focus-visible { outline: none; box-shadow: ${T.focusRing}; }
      @keyframes fadeup { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes ringDraw { from { stroke-dashoffset: var(--ring-len); } to { stroke-dashoffset: var(--ring-offset); } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
      }
      input { font-size: 16px; } /* no iOS zoom */
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
}

function ScoreRing({ score }) {
  const R = 56, C = 2 * Math.PI * R;
  const offset = C * (1 - Math.max(0, Math.min(100, score)) / 100);
  const tone = score >= 75 ? T.green : score >= 45 ? T.amber : T.red;
  return (
    <div style={{ position: "relative", width: "150px", height: "150px", flexShrink: 0 }}>
      <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={`Audit score ${score} out of 100`}>
        <circle cx="75" cy="75" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
        <circle cx="75" cy="75" r={R} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C}
          style={{ "--ring-len": C, "--ring-offset": offset, strokeDashoffset: offset, animation: "ringDraw 1.1s cubic-bezier(0.16,1,0.3,1) both", transformOrigin: "center", transform: "rotate(-90deg)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: "34px", fontWeight: 700, color: T.inkDeep, fontFamily: T.fontMono, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: "9.5px", color: T.faint, textTransform: "uppercase", letterSpacing: "0.14em", fontFamily: T.fontDisplay, marginTop: "4px" }}>of 100</div>
      </div>
    </div>
  );
}

function Check({ check, index }) {
  const meta = STATUS_META[check.status] || STATUS_META.warn;
  return (
    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "12px 14px", background: T.subtle, border: `1px solid ${T.lineSoft}`, borderRadius: T.rMd, animation: `fadeup 0.4s ${T.easeOut} both`, animationDelay: `${Math.min(index, 10) * 45}ms` }}>
      <span aria-hidden style={{ width: "22px", height: "22px", borderRadius: "7px", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 800, color: meta.color, background: `${meta.color}1A`, border: `1px solid ${meta.color}33` }}>{meta.icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: T.ink }}>{check.label}</span>
          <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.color, fontFamily: T.fontDisplay }}>{meta.label}</span>
        </div>
        <div style={{ fontSize: "12px", color: T.muted, marginTop: "3px", lineHeight: 1.55 }}>{check.detail}</div>
      </div>
    </div>
  );
}

export function AuditApp() {
  useInjectGlobalCss();
  const [form, setForm] = useState({ website: "", email: "", name: "", business: "" });
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [results, setResults] = useState(null);
  const resultsRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const run = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    if (!form.website.trim()) { setErrorMsg("Enter your website address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) { setErrorMsg("Enter a real email — the follow-up goes there."); return; }
    setBusy(true);
    try {
      const res = await fetch("/.netlify/functions/audit-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The audit couldn't run. Try again in a minute.");
      setResults(data);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (err) {
      setErrorMsg(err.message);
    }
    setBusy(false);
  };

  const checks = results?.checks || [];
  const failing = checks.filter((c) => c.status === "fail").length;

  return (
    <div style={{ minHeight: "100vh", color: T.ink }}>
      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "0 20px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "22px 0" }}>
          <span style={{ width: "18px", height: "18px", borderRadius: "5px", background: T.goldGrad, boxShadow: "0 1px 3px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.35)" }} />
          <span style={{ fontSize: "12px", fontWeight: 800, color: T.inkBrand, letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: T.fontDisplay }}>Clarify Paid Search</span>
        </div>

        {/* Hero — the thesis */}
        <div style={{ padding: "34px 0 30px", animation: `fadeup 0.5s ${T.easeOut} both` }}>
          <h1 style={{ fontSize: "clamp(28px, 6vw, 42px)", fontWeight: 800, color: T.inkDeep, fontFamily: T.fontDisplay, lineHeight: 1.12, letterSpacing: "-0.01em", maxWidth: "600px" }}>
            Most local businesses pay for clicks they can't measure.
          </h1>
          <p style={{ fontSize: "15px", color: T.muted, lineHeight: 1.65, marginTop: "16px", maxWidth: "540px" }}>
            Run a free 60-second audit of your site's ad-readiness — conversion tracking, analytics,
            speed, mobile. You get specific findings, not a sales pitch.
          </p>
        </div>

        {/* The gate — email runs the audit */}
        <form onSubmit={run} style={{ background: T.surface, border: `1px solid ${T.lineInk}`, borderRadius: T.rLg, boxShadow: `${T.shadowCard}, ${T.glowBrass}`, padding: "22px", display: "flex", flexDirection: "column", gap: "12px", animation: `fadeup 0.5s ${T.easeOut} 0.08s both` }}>
          <label style={{ fontSize: "10px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay }}>
            Your website
            <input value={form.website} onChange={set("website")} placeholder="yourbusiness.com" autoComplete="url" inputMode="url"
              style={{ marginTop: "6px", width: "100%", background: T.subtle, border: `1px solid ${T.line}`, borderRadius: T.rSm, padding: "12px 14px", color: T.ink, outline: "none", fontWeight: 500, letterSpacing: 0, textTransform: "none" }} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }} className="audit-grid2">
            <label style={{ fontSize: "10px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay }}>
              Email
              <input value={form.email} onChange={set("email")} placeholder="you@yourbusiness.com" type="email" autoComplete="email"
                style={{ marginTop: "6px", width: "100%", background: T.subtle, border: `1px solid ${T.line}`, borderRadius: T.rSm, padding: "12px 14px", color: T.ink, outline: "none", fontWeight: 500, letterSpacing: 0, textTransform: "none" }} />
            </label>
            <label style={{ fontSize: "10px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay }}>
              Business name <span style={{ opacity: 0.6 }}>(optional)</span>
              <input value={form.business} onChange={set("business")} placeholder="Lakeview Dental"
                style={{ marginTop: "6px", width: "100%", background: T.subtle, border: `1px solid ${T.line}`, borderRadius: T.rSm, padding: "12px 14px", color: T.ink, outline: "none", fontWeight: 500, letterSpacing: 0, textTransform: "none" }} />
            </label>
          </div>
          {errorMsg && (
            <div role="alert" style={{ fontSize: "12px", color: T.red, background: "rgba(248,113,113,0.09)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: T.rSm, padding: "9px 12px" }}>{errorMsg}</div>
          )}
          <button type="submit" disabled={busy}
            style={{ padding: "13px 20px", background: T.goldGrad, border: "none", borderRadius: T.rSm, color: T.textOnBrand, fontSize: "14px", fontWeight: 800, cursor: busy ? "wait" : "pointer", fontFamily: T.fontDisplay, letterSpacing: "0.02em" }}>
            {busy ? "Auditing your site…" : "Run the free audit"}
          </button>
          <div style={{ fontSize: "11px", color: T.faint, lineHeight: 1.5 }}>
            The report shows here instantly. Cameron personally follows up with the full breakdown — no list, no drip campaign.
          </div>
        </form>

        {/* Results */}
        {results && (
          <div ref={resultsRef} style={{ paddingTop: "36px" }}>
            <div style={{ background: T.surface, border: `1px solid ${T.lineInk}`, borderRadius: T.rLg, boxShadow: T.shadowCard, padding: "24px", display: "flex", gap: "24px", alignItems: "center", flexWrap: "wrap", animation: `fadeup 0.45s ${T.easeOut} both` }}>
              <ScoreRing score={results.score} />
              <div style={{ flex: 1, minWidth: "220px" }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay, marginBottom: "6px" }}>Ad-readiness score</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: T.inkDeep, fontFamily: T.fontDisplay, lineHeight: 1.35 }}>
                  {results.score >= 75 ? "Solid foundation — the gaps left are the expensive kind."
                    : results.score >= 45 ? `${failing} issue${failing === 1 ? "" : "s"} actively working against paid traffic.`
                    : "Paid traffic would leak badly right now — fix these first."}
                </div>
                <div style={{ fontSize: "12px", color: T.muted, marginTop: "8px", fontFamily: T.fontMono }}>{results.finalUrl || results.url}</div>
              </div>
            </div>

            {results.insights?.insights?.length > 0 && (
              <div style={{ marginTop: "14px", background: T.surface, border: `1px solid ${T.goldLine}`, borderRadius: T.rLg, padding: "18px 20px", animation: `fadeup 0.45s ${T.easeOut} 0.06s both` }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: T.gold, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay, marginBottom: "10px" }}>✦ What this means for your budget</div>
                <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {results.insights.insights.slice(0, 4).map((s, i) => (
                    <li key={i} style={{ fontSize: "13px", color: T.ink, lineHeight: 1.6 }}>{s}</li>
                  ))}
                </ul>
                {results.insights.priority && (
                  <div style={{ marginTop: "12px", fontSize: "12.5px", color: T.gold, fontWeight: 600 }}>→ {results.insights.priority}</div>
                )}
              </div>
            )}

            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {checks.map((c, i) => <Check key={c.key} check={c} index={i} />)}
            </div>

            {/* CTA */}
            <div style={{ marginTop: "22px", background: T.raised, border: `1px solid ${T.line}`, borderRadius: T.rLg, boxShadow: T.shadowCard, padding: "22px", textAlign: "center", animation: `fadeup 0.45s ${T.easeOut} 0.1s both` }}>
              <div style={{ fontSize: "16px", fontWeight: 800, color: T.inkDeep, fontFamily: T.fontDisplay, marginBottom: "6px" }}>Want these fixed — and your ads run like a portfolio?</div>
              <div style={{ fontSize: "12.5px", color: T.muted, lineHeight: 1.6, maxWidth: "420px", margin: "0 auto 16px" }}>
                Clarify manages Google Ads for Chicago businesses. 15 minutes, your numbers on screen, no deck.
              </div>
              {SCHEDULING_LINK_CONFIGURED ? (
                <a href={SCHEDULING_LINK} target="_blank" rel="noreferrer"
                  style={{ display: "inline-block", padding: "12px 26px", background: T.goldGrad, borderRadius: T.rSm, color: T.textOnBrand, fontSize: "13px", fontWeight: 800, textDecoration: "none", fontFamily: T.fontDisplay, boxShadow: T.glowBrass }}>
                  Book a free strategy call
                </a>
              ) : (
                <div style={{ fontSize: "13px", color: T.ink }}>
                  Reply to Cameron's follow-up email and he'll take it from there.
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: "48px", fontSize: "10.5px", color: T.ghost, textAlign: "center" }}>
          Clarify Paid Search · Chicago · This audit reads only your public homepage.
        </div>
      </div>
      <style>{`@media (max-width: 560px) { .audit-grid2 { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
