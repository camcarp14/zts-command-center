// ─── Settings — the small set of levers that used to be hardcoded ────────────
// Stored in app_settings (authenticated-only). The scheduling link feeds the
// Calendar tab, booking CTAs, and suggested replies with scheduling intent.
import { useEffect, useState } from "react";
import { T, card as cardStyle, sectionLabel, inputBase } from "../../theme.js";
import { useToast } from "../../ui.jsx";
import { seqDb } from "../../lib/sequenceDb.js";
import { SCHEDULING_LINK, SCHEDULING_LINK_CONFIGURED, SAFE_SEND_ADDRESS } from "../../config.js";
import { OPEN_TRACKING_LIVE } from "../../lib/sequences.js";

export function SettingsView() {
  const toast = useToast();
  const [link, setLink] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    seqDb.getSetting("scheduling_link")
      .then((v) => { const url = v?.url || (SCHEDULING_LINK_CONFIGURED ? SCHEDULING_LINK : ""); setLink(url); setSaved(url); })
      .catch(() => {});
  }, []);

  const save = async () => {
    const trimmed = link.trim();
    if (trimmed && !/^https?:\/\/.+\..+/.test(trimmed)) {
      toast.push("That doesn't look like a URL — include https://", { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      await seqDb.setSetting("scheduling_link", { url: trimmed });
      setSaved(trimmed);
      toast.push("Scheduling link saved — Calendar and booking CTAs use it now.", { tone: "success" });
    } catch (err) {
      toast.push("Couldn't save: " + err.message, { tone: "error" });
    }
    setBusy(false);
  };

  const Row = ({ label, children }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ fontSize: "10px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay }}>{label}</div>
      {children}
    </div>
  );

  return (
    <div style={{ padding: "24px 28px", maxWidth: "640px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div>
        <h2 style={{ fontSize: "18px", fontWeight: 800, color: T.ink, fontFamily: T.fontDisplay, margin: "0 0 4px" }}>Settings</h2>
        <div style={{ fontSize: "12px", color: T.muted }}>Product-level levers. Everything else lives where the work happens.</div>
      </div>

      <div style={{ ...cardStyle, padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <Row label="Scheduling link">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://calendar.app.google/… or your Calendly URL"
            style={{ ...inputBase, fontSize: "13px", fontFamily: T.fontMono }} />
          <div style={{ fontSize: "11px", color: T.muted, lineHeight: 1.55 }}>
            Used by the Calendar tab, booking CTAs, and scheduling-intent reply drafts. The public
            /audit page uses the build-time default in <span style={{ fontFamily: T.fontMono }}>src/config.js</span> — set both.
          </div>
          <div>
            <button onClick={save} disabled={busy || link === saved}
              style={{ padding: "9px 18px", background: link !== saved ? T.goldGrad : T.subtle, border: link !== saved ? "none" : `1px solid ${T.lineSoft}`, borderRadius: T.rSm, color: link !== saved ? T.textOnBrand : T.ghost, fontSize: "11.5px", fontWeight: 800, cursor: link !== saved && !busy ? "pointer" : "not-allowed", fontFamily: T.fontDisplay }}>
              {busy ? "Saving…" : "Save link"}
            </button>
          </div>
        </Row>
      </div>

      <div style={{ ...cardStyle, padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ ...sectionLabel }}>How sending works (by design)</div>
        {[
          { dot: T.green, title: "Human-click sending, always", text: "Sequences, AI replies, and manual drafts all land in the Approval Queue. Nothing is ever sent by the system on its own." },
          { dot: T.amber, title: "Safe mode is the default", text: `A fresh browser reroutes every send to ${SAFE_SEND_ADDRESS}. Going live is the two-click pill in the header, per device.` },
          { dot: OPEN_TRACKING_LIVE ? T.green : T.faint, title: OPEN_TRACKING_LIVE ? "Open tracking: live" : "Open tracking: dormant", text: OPEN_TRACKING_LIVE ? "Opens are recorded via the tracking pixel." : "Emails send as plain text today, so open tracking is off; sequence gates based on opens act as “if no reply”. Link clicks ARE tracked (wrapped short links). The schema and pixel endpoint are already in place for when sends go HTML." },
        ].map((r) => (
          <div key={r.title} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: r.dot, marginTop: "5px", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "12.5px", fontWeight: 700, color: T.ink }}>{r.title}</div>
              <div style={{ fontSize: "11.5px", color: T.muted, lineHeight: 1.55, marginTop: "2px" }}>{r.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
