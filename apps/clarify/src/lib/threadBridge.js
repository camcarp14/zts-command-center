// ─── Legacy thread bridge ─────────────────────────────────────────────────────
// Cards sent before the messages ledger existed carry their history only on
// outreach columns (sent_at, reply_body…). This synthesizes ledger-shaped rows
// for those threads so the sequence engine and analytics read ONE timeline.
// Single source of truth — both consumers import this; do not fork the rule.
export function withLegacyBridge(card, threadMessages = []) {
  const out = [...threadMessages];
  if (card?.sent_at && !out.some((m) => m.direction === "outbound" && m.status === "sent")) {
    out.push({
      id: `legacy-${card.id}`, outreach_id: card.id,
      direction: "outbound", status: "sent", kind: "initial", step_id: null,
      sent_at: card.sent_at,
    });
  }
  if ((card?.reply_body || card?.replied_at) && !out.some((m) => m.direction === "inbound")) {
    out.push({
      id: `legacy-reply-${card.id}`, outreach_id: card.id,
      direction: "inbound", status: "received", kind: "reply",
      created_at: card.replied_at || card.updated_at,
    });
  }
  return out;
}
