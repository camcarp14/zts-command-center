import { useState, useEffect, useRef } from "react";
import { T } from "../../theme";
import { callClaude } from "../../lib/claudeApi.js";
import { GLOBAL_AGENT_PROMPT } from "../../lib/prompts.js";
import { sm } from "../../lib/store.js";
import { fetchPortfolioCounts } from "../../lib/supabase.js";

// ─── Global Agent ──────────────────────────────────────────────────────────────
// Persistent across tabs. Remembers conversation via sessionMemory (survives
// reloads). Rebuilds a fresh context block from real state on every message —
// this is the dynamic-context half of context engineering; GOVERNANCE_RULES is
// the static half, cached on every call so it's cheap regardless of frequency.
export function GlobalAgent({ cards }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => sm.get("agent_conversation") || []);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, open]);

  const clearMemory = () => {
    sm.del("agent_conversation");
    setMessages([]);
  };

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg = { role: "user", content: input.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      const counts = await fetchPortfolioCounts();
      const analysisKeys = sm.keys("analysis_");
      const analysisSummaries = analysisKeys.map(k => sm.get(`analysis_${k}`)).filter(Boolean);
      const queueKeys = sm.keys("queue_");
      const pendingByClient = queueKeys.map(k => {
        const items = sm.get(`queue_${k}`) || [];
        const pending = items.filter(i => i.status === "pending").length;
        return pending > 0 ? `${k.replace(/_/g, " ")}: ${pending} pending` : null;
      }).filter(Boolean);
      const outreachCounts = cards ? {
        prospected: cards.filter(c => c.status === "prospected").length,
        draft: cards.filter(c => ["draft", "draft_ready"].includes(c.status)).length,
        sent: cards.filter(c => c.status === "sent").length,
        replied: cards.filter(c => c.status === "replied").length,
      } : null;

      const contextBlock = `CURRENT SYSTEM STATE (built fresh, just now)
Outreach pipeline: ${outreachCounts ? `${outreachCounts.prospected} prospected, ${outreachCounts.draft} draft${outreachCounts.draft !== 1 ? "s" : ""} ready, ${outreachCounts.sent} sent, ${outreachCounts.replied} replied` : "not loaded in this view"}
Clients (from Supabase, live): ${counts.activeClients} active, ${counts.criticalFindings} critical findings, ${counts.pendingActions} pending actions awaiting approval
Saved client analyses (from Analyst tab): ${analysisSummaries.length ? analysisSummaries.map(a => `${a.clientName} — ${a.signal} — ${a.topFinding}`).join(" | ") : "none yet"}
Local action queues with pending items: ${pendingByClient.length ? pendingByClient.join(", ") : "none pending"}`;

      const apiMessages = nextMessages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      apiMessages[apiMessages.length - 1] = { role: "user", content: `${contextBlock}\n\nQuestion: ${userMsg.content}` };

      const r = await callClaude({ model: "claude-sonnet-4-6", max_tokens: 700, system: [{ type: "text", text: GLOBAL_AGENT_PROMPT, cache_control: { type: "ephemeral" } }], messages: apiMessages, fn: "global_agent" });

      const text = r.text || "I had trouble responding — try again.";
      const finalMessages = [...nextMessages, { role: "assistant", content: text }];
      setMessages(finalMessages);
      sm.set("agent_conversation", finalMessages.slice(-40));
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong reaching the agent. Try again in a moment." }]);
    }
    setSending(false);
  };

  return (
    <div className="co-agent-root" style={{ position: "fixed", bottom: "20px", right: "20px", zIndex: 500 }}>
      {!open && (
        <button onClick={() => setOpen(true)}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = T.shadowHover; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = T.shadowFloat; }}
          style={{ padding: "13px 22px", background: T.goldGrad, border: "none", borderRadius: "30px", color: T.textOnBrand, fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: T.fontDisplay, letterSpacing: "0.04em", boxShadow: T.shadowFloat, display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: T.textOnBrand }}>✦</span> Ask Clarify
        </button>
      )}
      {open && (
        <div className="co-agent-panel" style={{ width: "380px", height: "520px", maxWidth: "calc(100vw - 24px)", background: T.surface, borderRadius: "16px", boxShadow: T.shadowModal, border: `1px solid ${T.lineInk}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.lineInk}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: T.surface }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: T.gold, fontSize: "13px" }}>✦</span>
              <span style={{ fontSize: "12px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>Clarify Assistant</span>
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              {messages.length > 0 && <button onClick={clearMemory} title="Clear conversation memory" style={{ background: "none", border: "none", color: T.faint, fontSize: "10px", cursor: "pointer" }}>Clear</button>}
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: T.faint, fontSize: "16px", cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 16px", color: T.muted }}>
                <div style={{ fontSize: "22px", marginBottom: "10px" }}>✦</div>
                <div style={{ fontSize: "12px", lineHeight: 1.6 }}>Ask about outreach pipeline status, client findings, or what to prioritize today. I read live state from across the app before answering.</div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "82%", padding: "9px 13px", background: m.role === "user" ? T.goldSoft : T.subtle, border: m.role === "assistant" ? `1px solid ${T.lineInk}` : "none", borderRadius: m.role === "user" ? "12px 12px 3px 12px" : "12px 12px 12px 3px", fontSize: "12px", color: T.ink, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div style={{ display: "flex" }}>
                <div style={{ padding: "10px 14px", background: T.subtle, border: `1px solid ${T.lineInk}`, borderRadius: "12px 12px 12px 3px" }}>
                  <span style={{ color: T.faint, fontSize: "16px", letterSpacing: "3px" }}>···</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div style={{ padding: "12px 14px", borderTop: `1px solid ${T.lineInk}`, display: "flex", gap: "8px" }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask anything across Outreach, Analyst, Clients…"
              style={{ flex: 1, padding: "9px 12px", background: T.subtle, border: `1px solid ${T.line}`, borderRadius: "8px", fontSize: "12px", color: T.ink, outline: "none" }} />
            <button onClick={send} disabled={!input.trim() || sending}
              style={{ padding: "9px 16px", background: !input.trim() || sending ? T.subtle : T.gold, border: "none", borderRadius: "8px", color: !input.trim() || sending ? T.faint : T.textOnBrand, fontSize: "11px", fontWeight: 700, cursor: !input.trim() || sending ? "not-allowed" : "pointer", fontFamily: T.fontDisplay }}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
