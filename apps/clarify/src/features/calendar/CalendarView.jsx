import { useState, useMemo, useEffect } from "react";
import { T } from "../../theme";
import { DEFAULT_MEETING_MINUTES, SCHEDULING_LINK, SCHEDULING_LINK_CONFIGURED } from "../../config.js";
import { MonthCalendar } from "../mission/MissionControl.jsx";
import { createMeeting, suggestSlots } from "../../lib/meetings.js";
import { store } from "../../lib/store.js";
import { db } from "../../lib/supabase.js";
import { seqDb } from "../../lib/sequenceDb.js";

// ─── Calendar View — pipeline-aware booking + shareable link ──────────────────
export function BookingModal({ card, onClose, onBooked }) {
  const prospect = card.prospect || {};
  const contact = card.contact || {};
  const slots = useMemo(() => suggestSlots(new Date()), []);
  const [selectedSlot, setSelectedSlot] = useState(slots[0]);
  const [duration, setDuration] = useState(DEFAULT_MEETING_MINUTES);
  const [customTime, setCustomTime] = useState("");
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const title = `${prospect.business_name || "Prospect"} <> Clarify Paid Search`;
  const details = `Intro call to walk through ${prospect.business_name || "your"} Google Ads — what's working, what's leaking, and where the quick wins are.\n\nBooked from Clarify.`;

  const book = async () => {
    setBooking(true); setError("");
    try {
      const start = customTime ? new Date(customTime) : selectedSlot;
      const res = await createMeeting({ title, details, start, durationMin: duration, guestEmail: contact.email, guestName: contact.name });
      setResult(res);
      onBooked && onBooked(card, start, res);
    } catch (e) {
      setError(e.message || "Booking failed");
    }
    setBooking(false);
  };

  const fmtSlot = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="co-modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadein 0.15s ease both" }}>
      <div className="co-modal-sheet" onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: "16px", padding: "24px 26px", width: "440px", maxWidth: "92vw", boxShadow: T.shadowModal }}>
        {!result ? (
          <>
            <div style={{ fontSize: "15px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay, marginBottom: "3px" }}>Book a meeting</div>
            <div style={{ fontSize: "12px", color: T.faint, marginBottom: "18px" }}>{prospect.business_name}{contact.name ? ` · ${contact.name}` : ""}{contact.email ? ` · ${contact.email}` : ""}</div>

            <div style={{ fontSize: "10px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay, marginBottom: "8px" }}>Suggested times</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
              {slots.map((s, i) => {
                const sel = !customTime && selectedSlot && s.getTime() === selectedSlot.getTime();
                return <button key={i} onClick={() => { setSelectedSlot(s); setCustomTime(""); }}
                  style={{ textAlign: "left", padding: "10px 13px", background: sel ? T.goldSoft : T.subtle, border: `1px solid ${sel ? T.goldLine : T.line}`, borderRadius: "9px", cursor: "pointer", fontSize: "13px", color: sel ? T.gold : T.ink, fontWeight: sel ? 700 : 500, fontFamily: T.fontMono }}>
                  {fmtSlot(s)}
                </button>;
              })}
            </div>

            <div style={{ display: "flex", gap: "10px", marginBottom: "18px", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: T.fontDisplay, marginBottom: "5px" }}>Or pick a time</div>
                <input type="datetime-local" value={customTime} onChange={e => setCustomTime(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", background: T.subtle, border: `1px solid ${T.line}`, borderRadius: "8px", fontSize: "12px", fontFamily: T.fontMono, color: T.ink }} />
              </div>
              <div style={{ width: "100px" }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: T.fontDisplay, marginBottom: "5px" }}>Length</div>
                <select value={duration} onChange={e => setDuration(Number(e.target.value))}
                  style={{ width: "100%", padding: "8px 10px", background: T.subtle, border: `1px solid ${T.line}`, borderRadius: "8px", fontSize: "12px", color: T.ink }}>
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={45}>45 min</option>
                  <option value={60}>60 min</option>
                </select>
              </div>
            </div>

            {error && <div style={{ marginBottom: "12px", padding: "8px 12px", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "8px", fontSize: "11px", color: T.red }}>{error}</div>}

            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={book} disabled={booking} style={{ flex: 1, padding: "11px", background: booking ? T.subtle : T.goldGrad, border: "none", borderRadius: "10px", color: booking ? T.muted : T.textOnBrand, fontSize: "12px", fontWeight: 700, cursor: booking ? "default" : "pointer", fontFamily: T.fontDisplay }}>
                {booking ? "Opening…" : "📅 Create calendar invite"}
              </button>
              <button onClick={onClose} style={{ padding: "11px 16px", background: "transparent", border: `1px solid ${T.line}`, borderRadius: "10px", color: T.muted, fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            </div>
            <div style={{ fontSize: "10px", color: T.faint, marginTop: "10px", textAlign: "center" }}>Opens Google Calendar prefilled with the prospect as guest — confirm there to send the invite.</div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontSize: "32px", marginBottom: "10px", color: T.green }}>✓</div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay, marginBottom: "6px" }}>Meeting created</div>
            <div style={{ fontSize: "12px", color: T.muted, marginBottom: "16px" }}>Google Calendar opened in a new tab — confirm there to send the invite. The pipeline already shows it as booked.</div>
            {result.meetLink && <a href={result.meetLink} target="_blank" rel="noopener" style={{ display: "block", fontSize: "12px", color: T.blueDeep, marginBottom: "8px" }}>{result.meetLink}</a>}
            <button onClick={onClose} style={{ padding: "10px 22px", background: T.goldGrad, border: "none", borderRadius: "9px", color: T.textOnBrand, fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: T.fontDisplay }}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}


export function CalendarView({ cards, onStatusChange, onDataChange }) {
  const [bookingCard, setBookingCard] = useState(null);
  const [copied, setCopied] = useState(false);
  const [localMeetings, setLocalMeetings] = useState(() => store.get("meetings", []));
  const [schedulingLink, setSchedulingLink] = useState(SCHEDULING_LINK);

  // The scheduling link is a setting now (Settings tab); config is the fallback.
  useEffect(() => {
    seqDb.getSetting("scheduling_link").then((v) => { if (v?.url) setSchedulingLink(v.url); }).catch(() => {});
  }, []);
  const linkConfigured = SCHEDULING_LINK_CONFIGURED || schedulingLink !== SCHEDULING_LINK;

  // Meetings live on the outreach row (meeting_at/meeting_outcome — survives
  // any browser); the old localStorage array is merged in read-only so history
  // from before the migration still shows.
  const meetings = useMemo(() => {
    const fromCards = cards
      .filter((c) => c.meeting_at)
      .map((c) => ({ id: `db_${c.id}`, cardId: c.id, business: c.prospect?.business_name, email: c.contact?.email, start: c.meeting_at, outcome: c.meeting_outcome || "pending", db: true }));
    const dbCardIds = new Set(fromCards.map((m) => m.cardId));
    const legacy = localMeetings.filter((m) => !dbCardIds.has(m.cardId));
    return [...fromCards, ...legacy].sort((a, b) => new Date(a.start) - new Date(b.start));
  }, [cards, localMeetings]);

  // Pipeline-aware: prospects who replied (warmest, ready to book) + sent (in play)
  const readyToBook = cards.filter(c => c.status === "replied");
  const inPlay = cards.filter(c => c.status === "sent");

  const onBooked = async (card, start) => {
    // Persist on the pipeline row — the durable record.
    try {
      await db.updateOutreach(card.id, { meeting_at: start.toISOString(), meeting_outcome: "pending", status: "meeting" });
    } catch {}
    if (onStatusChange && card.id) onStatusChange(card.id, "meeting");
    // Refresh the shared cards cache so meeting_at shows up in 'Upcoming'
    // immediately — onStatusChange only patches `status` locally.
    if (onDataChange) await onDataChange();
  };

  // Record how a meeting went — closes the loop on the pipeline.
  const setOutcome = async (meetingId, outcome) => {
    const m = meetings.find((x) => x.id === meetingId);
    if (!m) return;
    if (m.db && m.cardId) {
      try { await db.updateOutreach(m.cardId, { meeting_outcome: outcome }); } catch {}
      // A won meeting flips back to replied (in play as a client conversation).
      if (onStatusChange && outcome === "won") onStatusChange(m.cardId, "replied");
      if (onDataChange) await onDataChange();
    } else {
      const next = localMeetings.map((x) => x.id === meetingId ? { ...x, outcome } : x);
      setLocalMeetings(next);
      store.set("meetings", next);
      if (onStatusChange && m.cardId && outcome === "won") onStatusChange(m.cardId, "replied");
    }
  };

  const copyLink = () => { try { navigator.clipboard.writeText(schedulingLink); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  const upcoming = meetings.filter(m => new Date(m.start) >= new Date(Date.now() - 3600000)).sort((a, b) => new Date(a.start) - new Date(b.start));
  const pastNeedsOutcome = meetings.filter(m => new Date(m.start) < new Date(Date.now() - 3600000) && (!m.outcome || m.outcome === "pending")).sort((a, b) => new Date(b.start) - new Date(a.start));
  const fmtSlot = (iso) => { const d = new Date(iso); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };

  const Card = ({ children, style }) => <div style={{ background: T.surface, borderRadius: "16px", border: `1px solid ${T.lineInk}`, boxShadow: T.shadowCard, padding: "18px 20px", ...style }}>{children}</div>;

  return (
    <div style={{ minHeight: "calc(100vh - 48px)", background: "transparent", padding: "24px 28px" }}>
      <div style={{ marginBottom: "20px" }}>
        <div style={{ fontSize: "18px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>Calendar</div>
        <div style={{ fontSize: "12px", color: T.faint, marginTop: "2px" }}>Book meetings from your pipeline, or share a link that lets prospects pick a time.</div>
      </div>

      {/* Shareable booking link — the Settings-saved value wins; config is only the build-time fallback */}
      <Card style={{ marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay, marginBottom: "5px" }}>Your booking link</div>
          {linkConfigured
            ? <div style={{ fontSize: "13px", color: T.ink, fontFamily: T.fontMono }}>{schedulingLink}</div>
            : <div style={{ fontSize: "12px", color: T.amber }}>Not set up yet — add your Google/Calendly booking URL in System → Settings.</div>}
        </div>
        {linkConfigured && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={copyLink} style={{ padding: "9px 16px", background: copied ? "rgba(62,207,142,0.1)" : T.goldGrad, border: "none", borderRadius: "9px", color: copied ? T.green : T.textOnBrand, fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: T.fontDisplay }}>{copied ? "✓ Copied" : "Copy link"}</button>
            <a href={schedulingLink} target="_blank" rel="noopener" style={{ padding: "9px 16px", background: "transparent", border: `1px solid ${T.line}`, borderRadius: "9px", color: T.muted, fontSize: "12px", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Open ›</a>
          </div>
        )}
      </Card>

      <div className="co-grid2" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "16px" }}>
        {/* Ready to book from pipeline */}
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.13em", fontFamily: T.fontDisplay, marginBottom: "12px" }}>Ready to Book</div>
          {readyToBook.length === 0 && inPlay.length === 0 ? (
            <Card><div style={{ fontSize: "13px", color: T.faint, textAlign: "center", padding: "20px 0" }}>No prospects in scheduling range yet. Replies and sent threads show up here to book.</div></Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {readyToBook.map(c => (
                <Card key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", borderLeft: `3px solid ${T.pink}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>{c.prospect?.business_name}</div>
                    <div style={{ fontSize: "11px", color: T.faint, marginTop: "1px" }}>💬 Replied{c.contact?.name ? ` · ${c.contact.name}` : ""} · warmest — book now</div>
                  </div>
                  <button onClick={() => setBookingCard(c)} style={{ padding: "8px 14px", background: T.pink, border: "none", borderRadius: "8px", color: T.textOnBrand, fontSize: "11px", fontWeight: 700, cursor: "pointer", flexShrink: 0, fontFamily: T.fontDisplay }}>📅 Book</button>
                </Card>
              ))}
              {inPlay.map(c => (
                <Card key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>{c.prospect?.business_name}</div>
                    <div style={{ fontSize: "11px", color: T.faint, marginTop: "1px" }}>Sent · propose a time to move it forward</div>
                  </div>
                  <button onClick={() => setBookingCard(c)} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${T.line}`, borderRadius: "8px", color: T.muted, fontSize: "11px", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>📅 Book</button>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming meetings */}
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.13em", fontFamily: T.fontDisplay, marginBottom: "12px" }}>Upcoming</div>
          {upcoming.length === 0 ? (
            <Card><div style={{ fontSize: "13px", color: T.faint, textAlign: "center", padding: "20px 0" }}>No meetings booked yet.</div></Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {upcoming.map(m => (
                <Card key={m.id} style={{ borderLeft: `3px solid ${T.blueDeep}` }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>{m.business}</div>
                  <div style={{ fontSize: "11px", color: T.muted, marginTop: "3px", fontFamily: T.fontMono }}>{fmtSlot(m.start)}</div>
                  {m.email && <div style={{ fontSize: "10px", color: T.faint, marginTop: "2px" }}>{m.email}</div>}
                  {m.link && <a href={m.link} target="_blank" rel="noopener" style={{ fontSize: "10px", color: T.blueDeep, marginTop: "4px", display: "inline-block" }}>View event ›</a>}
                </Card>
              ))}
            </div>
          )}

          {/* Past meetings awaiting an outcome — closes the loop */}
          {pastNeedsOutcome.length > 0 && (
            <div style={{ marginTop: "18px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.13em", fontFamily: T.fontDisplay, marginBottom: "12px" }}>How'd it go?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {pastNeedsOutcome.map(m => (
                  <Card key={m.id} style={{ borderLeft: `3px solid ${T.amber}` }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>{m.business}</div>
                    <div style={{ fontSize: "11px", color: T.faint, marginTop: "3px", fontFamily: T.fontMono }}>{fmtSlot(m.start)}</div>
                    <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                      {[["won","Won",T.green],["followup","Follow up",T.blue],["noshow","No-show",T.faint],["lost","Lost",T.red]].map(([k,l,col]) => (
                        <button key={k} onClick={() => setOutcome(m.id, k)} style={{ flex: 1, padding: "6px 4px", background: col + "12", border: `1px solid ${col}30`, borderRadius: "7px", color: col, fontSize: "10px", fontWeight: 700, cursor: "pointer", fontFamily: T.fontDisplay }}>{l}</button>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Month grid — full view of booked meetings */}
      <MonthCalendar hideOpenLink cards={cards} />

      {bookingCard && <BookingModal card={bookingCard} onClose={() => setBookingCard(null)} onBooked={onBooked} />}
    </div>
  );
}
