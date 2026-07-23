import { useState } from "react";
import { T, inputBase, card as cardBase } from "../../theme";
import { sbAuth } from "../../lib/supabase.js";

// ─── Main App ────────────────────────────────────────────────────────────────
export function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError("");
    try {
      const session = await sbAuth.signIn(email, password);
      localStorage.setItem("clarify_token", session.access_token);
      localStorage.setItem("clarify_refresh", session.refresh_token || "");
      onLogin(session.access_token);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: "380px", padding: "0 24px" }}>
        {/* Brand */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div style={{ fontSize: "13px", fontWeight: 800, color: T.gold, letterSpacing: "0.16em", textTransform: "uppercase", fontFamily: T.fontDisplay, marginBottom: "8px" }}>Clarify</div>
          <div style={{ fontSize: "13px", color: T.muted, letterSpacing: "0.02em" }}>Paid Search Outreach</div>
        </div>

        {/* Card */}
        <div style={{ ...cardBase, padding: "32px" }}>
          <div style={{ fontSize: "18px", fontWeight: 700, color: T.ink, marginBottom: "6px", fontFamily: T.fontDisplay, letterSpacing: "-0.01em" }}>Sign in</div>
          <div style={{ fontSize: "13px", color: T.muted, marginBottom: "28px" }}>Enter your credentials to continue</div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "11px", fontWeight: 600, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'Syne', system-ui", display: "block", marginBottom: "6px" }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="you@domain.com"
              style={{ ...inputBase }} />
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label style={{ fontSize: "11px", fontWeight: 600, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "'Syne', system-ui", display: "block", marginBottom: "6px" }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              placeholder="••••••••"
              style={{ ...inputBase }} />
          </div>

          {error && (
            <div style={{ marginBottom: "16px", padding: "10px 14px", background: `${T.red}14`, border: `1px solid ${T.red}33`, borderRadius: "8px", fontSize: "13px", color: T.red }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading || !email || !password}
            style={{ width: "100%", padding: "12px", background: loading ? "rgba(255,255,255,0.06)" : T.goldGrad, border: "none", borderRadius: "9px", color: loading ? T.muted : T.textOnBrand, boxShadow: loading ? "none" : T.glowBrass, fontSize: "13px", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.04em", fontFamily: "'Syne', system-ui", transition: "background 0.15s" }}>
            {loading ? "Signing in…" : "Sign In →"}
          </button>
        </div>

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "11px", color: T.faint }}>
          Clarify Paid Search · Private Access
        </div>
      </div>
    </div>
  );
}
