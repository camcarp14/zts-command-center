import { Fragment } from "react";
import { T } from "../theme";
import { sm } from "../lib/store.js";
import { normEmail } from "../lib/supabase.js";

// One journey, six stages — rendered on inbound leads, outreach threads, and clients
// so every surface reads the same story about where a lead stands.
export function LeadJourney({ card, hasInbound = null, isClient = null }) {
  const email = normEmail(card?.contact?.email);
  const clientLinked = isClient !== null ? isClient
    : !!(email && sm.keys("client_origin_").some(id => normEmail((sm.get(`client_origin_${id}`) || {}).email) === email));
  const contacted = !!card?.sent_at || ["sent", "replied", "meeting"].includes(card?.status);
  const replied = !!card?.reply_body || ["replied", "meeting"].includes(card?.status);
  const stages = [
    hasInbound === null ? null : { label: "Inbound", on: hasInbound },
    { label: "Pipeline", on: !!card },
    { label: "Contacted", on: contacted },
    { label: "Replied", on: replied },
    { label: "Meeting", on: card?.status === "meeting" },
    { label: "Client", on: clientLinked },
  ].filter(Boolean);
  const lastOn = stages.reduce((m, s, i) => (s.on ? i : m), -1);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
      {stages.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && <span style={{ width: "14px", height: "1px", background: i <= lastOn ? T.gold : T.line }} />}
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: s.on ? T.gold : "transparent", border: `1.5px solid ${s.on ? T.gold : T.faint}`, boxShadow: i === lastOn && s.on ? `0 0 0 3px ${T.gold}2E` : "none" }} />
            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: T.fontDisplay, color: s.on ? T.inkDeep : T.faint }}>{s.label}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}
