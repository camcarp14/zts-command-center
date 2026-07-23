import { useState, useEffect } from "react";
import { T } from "../../theme";
import { EmptyState } from "../../ui.jsx";
import { eng, engineSpendThisHour, goalProgress, kb } from "../../lib/engine.js";
import { sm } from "../../lib/store.js";

// Shared roster metadata — Mission Control and the Agent Engine both read this so
// they always show the same agents. Each entry describes what the agent watches.
export const AGENT_META = [
  { key: "pipeline", name: "Pipeline Watcher", role: "Pipeline health", watches: "Prospects that have sat untouched 14+ days, and drafts written but never sent. Flags when either pile up so the pipeline keeps moving.", cost: "Free heuristic" },
  { key: "value", name: "Value Scout", role: "Revenue prioritization", watches: "High-value prospects (estimated $1.5k+/mo retainer) sitting un-worked. Surfaces the biggest dollar opportunities so you work money, not volume.", cost: "Free heuristic" },
  { key: "cadence", name: "Cadence Monitor", role: "Follow-up discipline", watches: "Sent threads that have crossed a follow-up step (bump → value-add → break-up) with no reply. Catches the silence that stalls deals.", cost: "Free heuristic" },
  { key: "reply", name: "Reply Sentinel", role: "Warm-lead triage", watches: "New replies, auto-classified by sentiment. Raises a critical flag the moment an INTERESTED reply lands so it never sits.", cost: "Free heuristic" },
  { key: "pattern", name: "Pattern Learner", role: "Learning over time", watches: "Which verticals actually convert. Builds a running reply-rate model from your sends and recommends where to weight prospecting.", cost: "Free heuristic" },
  { key: "cost", name: "Cost Sentinel", role: "Spend guardrail", watches: "AI spend over the last hour. Keeps the engine honest about token cost and warns before it climbs.", cost: "Free heuristic" },
  { key: "synthesizer", name: "Synthesizer", role: "Insight distillation", watches: "Accumulated observations from every other agent. Occasionally distills them into one highest-leverage move. When Verify is on, a separate skeptical checker (Sonnet) grades each insight against the pipeline facts before it ships. The only agent that spends tokens, and only when every lock opens.", cost: "Haiku · gated" },
];


// Per-agent detail modal — opened from the Mission roster or the Agents tab.
export function AgentDetail({ agentKey, onClose }) {
  const meta = AGENT_META.find(a => a.key === agentKey);
  const [feed, setFeed] = useState(() => kb.all().filter(e => e.agent === agentKey));
  const [ctrl, setCtrl] = useState(() => eng.get());
  useEffect(() => {
    const iv = setInterval(() => { setFeed(kb.all().filter(e => e.agent === agentKey)); setCtrl(eng.get()); }, 1500);
    return () => clearInterval(iv);
  }, [agentKey]);
  if (!meta) return null;

  const enabled = meta.key === "synthesizer" ? !ctrl.observeOnly : ctrl.agents[meta.key] !== false;
  const sigCount = { critical: 0, warning: 0, info: 0 };
  feed.forEach(e => { if (sigCount[e.signal] != null) sigCount[e.signal]++; });
  const latest = feed[0];
  const ago = (ts) => { if (!ts) return "never"; const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`; };
  const SEVC = { critical: T.red, warning: T.amber, info: T.blue, system: T.faint };

  const toggle = () => {
    if (meta.key === "synthesizer") { eng.set({ observeOnly: !ctrl.observeOnly }); }
    else { eng.setAgent(meta.key, !(ctrl.agents[meta.key] !== false)); }
    setCtrl(eng.get());
  };

  return (
    <div className="co-modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", animation: "fadein 0.15s ease both" }}>
      <div className="co-modal-sheet" onClick={e => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.lineInk}`, borderRadius: "16px", width: "520px", maxWidth: "94vw", maxHeight: "86vh", display: "flex", flexDirection: "column", boxShadow: T.shadowModal, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${T.lineInk}` }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "11px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: enabled && ctrl.running ? T.green : T.faint, boxShadow: enabled && ctrl.running ? `0 0 8px ${T.green}80` : "none", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>{meta.name}</div>
                <div style={{ fontSize: "11px", color: T.faint, marginTop: "1px" }}>{meta.role} · {meta.cost}</div>
              </div>
            </div>
            <button onClick={onClose} className="co-modal-close" style={{ background: "none", border: "none", color: T.faint, fontSize: "20px", cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
        </div>

        <div style={{ padding: "20px 24px", overflowY: "auto" }}>
          {/* What it watches */}
          <div style={{ fontSize: "10px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay, marginBottom: "7px" }}>What it watches</div>
          <p style={{ fontSize: "13px", color: T.muted, lineHeight: 1.6, margin: "0 0 18px" }}>{meta.watches}</p>

          {/* Stat strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "18px" }}>
            {[["Notes logged", feed.length], ["Last finding", ago(latest?.ts)], ["Status", enabled ? (ctrl.running ? "Active" : "Paused") : "Off"]].map((s, i) => (
              <div key={i} style={{ background: T.subtle, borderRadius: "10px", padding: "12px 13px" }}>
                <div style={{ fontSize: "9px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: T.fontDisplay, marginBottom: "5px" }}>{s[0]}</div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: T.ink, fontFamily: T.fontMono }}>{s[1]}</div>
              </div>
            ))}
          </div>

          {/* Signal mix */}
          {feed.length > 0 && (
            <div style={{ display: "flex", gap: "6px", marginBottom: "18px", flexWrap: "wrap" }}>
              {[["critical", "Critical"], ["warning", "Warning"], ["info", "Info"]].filter(([k]) => sigCount[k] > 0).map(([k, l]) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", color: T.muted, background: SEVC[k] + "12", padding: "3px 10px", borderRadius: "20px", fontWeight: 600 }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: SEVC[k] }} />{sigCount[k]} {l}
                </span>
              ))}
            </div>
          )}

          {/* This agent's history — rendered as a terse mono log, not prose */}
          <div style={{ fontSize: "10px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay, marginBottom: "10px" }}>History</div>
          {feed.length === 0 ? (
            <div style={{ fontSize: "12px", color: T.faint, padding: "16px 0", textAlign: "center" }}>Nothing logged yet. {ctrl.running ? "Watching now…" : "Start the engine to activate."}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {feed.slice(0, 30).map(e => (
                <div key={e.id} style={{ display: "flex", gap: "10px", padding: "10px 12px", background: T.subtle, borderRadius: "9px", borderLeft: `3px solid ${SEVC[e.signal] || T.faint}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "11px", color: T.muted, lineHeight: 1.5, fontFamily: T.fontMono }}>{e.text}</div>
                    <div style={{ fontSize: "9px", color: T.faint, marginTop: "3px", fontFamily: T.fontMono }}>{ago(e.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer control */}
        <div style={{ padding: "14px 24px", borderTop: `1px solid ${T.lineInk}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "11px", color: T.faint }}>{meta.key === "synthesizer" ? "Toggles synthesis (token spend) on/off" : "Enable or disable this watcher"}</span>
          <button onClick={toggle} style={{ padding: "8px 16px", background: enabled ? `${T.red}14` : `${T.green}14`, border: `1px solid ${enabled ? T.red : T.green}40`, borderRadius: "9px", color: enabled ? T.red : T.green, fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: T.fontDisplay }}>
            {enabled ? "Disable" : "Enable"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Agents tab — control panel + live knowledge feed ────────────────────────
export function AgentsView({ cards }) {
  const [ctrl, setCtrl] = useState(() => eng.get());
  const [feed, setFeed] = useState(() => kb.all());
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [, force] = useState(0);

  // Live refresh of control state + feed (the engine writes to the same stores).
  useEffect(() => {
    const iv = setInterval(() => { setCtrl(eng.get()); setFeed(kb.all()); force(x => x + 1); }, 1500);
    return () => clearInterval(iv);
  }, []);

  const update = (patch) => { eng.set(patch); setCtrl(eng.get()); };
  const toggleAgent = (k) => { eng.setAgent(k, !ctrl.agents[k]); setCtrl(eng.get()); };
  const [passFlash, setPassFlash] = useState(false);
  const runOnce = () => {
    // Set a force flag the engine consumes on its next 2s poll — guarantees a pass
    // regardless of the heartbeat timer, and works even while paused.
    sm.set("engine_force_pass", true);
    eng.set({ running: true });
    setCtrl(eng.get());
    setPassFlash(true);
    setTimeout(() => setPassFlash(false), 2500);
  };

  // Engine activity stats
  const lastTick = sm.get("engine_last_tick");
  const lastSynth = sm.get("engine_last_synth_ts");
  const spendHour = engineSpendThisHour();
  const ago = (ts) => { if (!ts) return "never"; const m = Math.floor((Date.now() - ts) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`; };

  const SEVC = { critical: T.red, warning: T.amber, info: T.blue, system: T.faint };
  const TYPE_LABEL = { observation: "Observed", learning: "Learned", insight: "Insight", system: "System" };

  // Agent toggle cards — on/off communicated via T.green/T.faint dot, not a color-swapped
  // card body, so the card itself stays a neutral T.surface regardless of state.
  const Toggle = ({ on, onClick, label, sub }) => (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: T.surface, border: `1px solid ${T.lineInk}`, borderRadius: "10px", cursor: "pointer" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: T.ink }}>{label}</div>
        {sub && <div style={{ fontSize: "10px", color: T.faint, marginTop: "1px" }}>{sub}</div>}
      </div>
      <div style={{ width: "38px", height: "22px", borderRadius: "12px", background: on ? T.green : "rgba(255,255,255,0.12)", position: "relative", flexShrink: 0, transition: "background 0.15s" }}>
        <div style={{ position: "absolute", top: "2px", left: on ? "18px" : "2px", width: "18px", height: "18px", borderRadius: "50%", background: T.inkDeep, transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} />
      </div>
    </div>
  );

  const agentMeta = [
    ["pipeline", "Pipeline Watcher", "Stale prospects, drafts piling up"],
    ["value", "Value Scout", "High-value leads sitting untouched"],
    ["cadence", "Cadence Monitor", "Follow-ups coming due"],
    ["reply", "Reply Sentinel", "Interested replies waiting"],
    ["pattern", "Pattern Learner", "Which verticals convert best"],
    ["cost", "Cost Sentinel", "AI spend guardrail"],
  ];

  return (
    <div style={{ minHeight: "calc(100vh - 48px)", background: "transparent", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>Agent Engine</div>
          <div style={{ fontSize: "12px", color: T.muted, marginTop: "2px" }}>A living roster that ideates on a free heartbeat and spends tokens only when it's worth it.</div>
        </div>
      </div>

      {/* Master control bar */}
      <div style={{ background: ctrl.running ? `linear-gradient(135deg, ${T.bg} 0%, ${T.raised} 100%)` : T.surface, border: ctrl.running ? "none" : `1px solid ${T.lineInk}`, borderRadius: "16px", padding: "18px 22px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", boxShadow: T.shadowCard }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button onClick={() => update({ running: !ctrl.running })} style={{ width: "52px", height: "52px", borderRadius: "50%", border: "none", background: ctrl.running ? T.green : T.raised, color: ctrl.running ? T.textOnBrand : T.ink, fontSize: "20px", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: ctrl.running ? `0 0 0 4px ${T.green}33` : "none" }}>
            {ctrl.running ? "⏸" : "▶"}
          </button>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay, display: "flex", alignItems: "center", gap: "8px" }}>
              {ctrl.running ? "Running" : "Paused"}
              {ctrl.running && <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: T.greenHi, animation: "pulse 2s infinite" }} />}
            </div>
            <div style={{ fontSize: "11px", color: T.muted, marginTop: "2px" }}>
              {ctrl.observeOnly ? "Observe-only · $0 spend" : `Synthesis on · Haiku${ctrl.allowSonnet ? "+Sonnet" : ""}`} · heartbeat {ctrl.cadenceSec}s
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "9px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: T.fontDisplay }}>Passes</div>
            <div style={{ fontSize: "13px", color: passFlash ? T.greenHi : ctrl.running ? T.ink : T.muted, fontFamily: T.fontMono, fontWeight: passFlash ? 700 : 400, transition: "color 0.2s" }}>{sm.get("engine_pass_count") || 0}{passFlash ? " ✓" : ""}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "9px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: T.fontDisplay }}>Last pass</div>
            <div style={{ fontSize: "13px", color: ctrl.running ? T.ink : T.muted, fontFamily: T.fontMono }}>{ago(lastTick)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "9px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: T.fontDisplay }}>Spend / hr</div>
            <div style={{ fontSize: "13px", color: spendHour > ctrl.hourlyCostCap * 0.8 ? T.red : ctrl.running ? T.ink : T.muted, fontFamily: T.fontMono }}>${spendHour.toFixed(3)}</div>
          </div>
          <button onClick={runOnce} style={{ padding: "9px 14px", background: ctrl.running ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)", border: ctrl.running ? "1px solid rgba(255,255,255,0.2)" : `1px solid ${T.line}`, borderRadius: "9px", color: ctrl.running ? T.ink : T.muted, fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: T.fontDisplay }}>⚡ Run pass now</button>
        </div>
      </div>

      <div className="co-grid-side" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "16px", alignItems: "start" }}>
        {/* Controls column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay, marginBottom: "2px" }}>Token Controls</div>
          <Toggle on={ctrl.observeOnly} onClick={() => update({ observeOnly: !ctrl.observeOnly })} label="Observe-only" sub="Heuristics only — never spend tokens" />
          <Toggle on={ctrl.allowSonnet} onClick={() => update({ allowSonnet: !ctrl.allowSonnet })} label="Allow Sonnet" sub="Off = synthesis stays on cheap Haiku" />
          <Toggle on={ctrl.pauseWhenIdle} onClick={() => update({ pauseWhenIdle: !ctrl.pauseWhenIdle })} label="Pause when idle" sub={`Auto-stop after ${ctrl.idleMin}m away`} />

          {/* Loop upgrades */}
          <div style={{ fontSize: "10px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay, margin: "8px 0 2px" }}>Loop</div>
          <Toggle on={ctrl.verifyInsights} onClick={() => update({ verifyInsights: !ctrl.verifyInsights })} label="Verify insights" sub="A checker grades each insight (Sonnet)" />
          <Toggle on={ctrl.goalMode} onClick={() => update({ goalMode: !ctrl.goalMode })} label="Goal mode" sub="Drive the loop toward a target" />
          {ctrl.goalMode && (() => {
            const goal = sm.get("engine_goal") || { type: "replies", target: 5 };
            const gp = goalProgress(cards);
            return (
              <div style={{ background: T.surface, border: `1px solid ${T.lineInk}`, borderRadius: "10px", padding: "12px 14px" }}>
                <select value={goal.type} onChange={e => { sm.set("engine_goal", { ...goal, type: e.target.value }); force(x => x + 1); }}
                  style={{ width: "100%", padding: "7px 9px", border: `1px solid ${T.line}`, borderRadius: "8px", fontSize: "11px", color: T.ink, background: T.subtle, marginBottom: "8px" }}>
                  <option value="replies">Get N prospects to replied</option>
                  <option value="meetings">Book N meetings</option>
                  <option value="send">Send N cold emails</option>
                  <option value="clear_drafts">Clear all drafts</option>
                </select>
                {goal.type !== "clear_drafts" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "11px", color: T.muted }}>Target</span>
                    <input type="number" min="1" max="50" value={goal.target} onChange={e => { sm.set("engine_goal", { ...goal, target: Number(e.target.value) }); force(x => x + 1); }}
                      style={{ width: "60px", padding: "5px 8px", border: `1px solid ${T.line}`, borderRadius: "7px", fontSize: "12px", fontFamily: T.fontMono, color: T.ink, background: T.subtle }} />
                  </div>
                )}
                {gp && (
                  <div>
                    <div style={{ height: "6px", background: T.lineSoft, borderRadius: "3px", overflow: "hidden", marginBottom: "5px" }}>
                      <div style={{ width: `${gp.pct}%`, height: "100%", background: gp.done ? T.green : T.gold, borderRadius: "3px", transition: "width 0.3s" }} />
                    </div>
                    <div style={{ fontSize: "10px", color: gp.done ? T.green : T.muted, fontFamily: T.fontMono, fontWeight: gp.done ? 700 : 400 }}>{gp.done ? "✓ Goal reached" : `${gp.current}/${gp.target} ${gp.unit} · ${gp.pct}%`}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Cadence slider — native range input, only its accent-color is themed */}
          <div style={{ background: T.surface, border: `1px solid ${T.lineInk}`, borderRadius: "10px", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: T.ink }}>Heartbeat</span>
              <span style={{ fontSize: "12px", color: T.muted, fontFamily: T.fontMono }}>{ctrl.cadenceSec}s</span>
            </div>
            <input type="range" min="10" max="120" step="5" value={ctrl.cadenceSec} onChange={e => update({ cadenceSec: Number(e.target.value) })} style={{ width: "100%", accentColor: T.green }} />
          </div>

          {/* Synthesis cadence */}
          <div style={{ background: T.surface, border: `1px solid ${T.lineInk}`, borderRadius: "10px", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: T.ink }}>Synthesis every</span>
              <span style={{ fontSize: "12px", color: T.muted, fontFamily: T.fontMono }}>{ctrl.synthEveryMin}m</span>
            </div>
            <input type="range" min="10" max="120" step="5" value={ctrl.synthEveryMin} onChange={e => update({ synthEveryMin: Number(e.target.value) })} style={{ width: "100%", accentColor: T.green }} />
          </div>

          {/* Cost cap */}
          <div style={{ background: T.surface, border: `1px solid ${T.lineInk}`, borderRadius: "10px", padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: T.ink }}>Hourly cost cap</span>
              <span style={{ fontSize: "12px", color: T.muted, fontFamily: T.fontMono }}>${ctrl.hourlyCostCap.toFixed(2)}</span>
            </div>
            <input type="range" min="0" max="2" step="0.05" value={ctrl.hourlyCostCap} onChange={e => update({ hourlyCostCap: Number(e.target.value) })} style={{ width: "100%", accentColor: T.green }} />
            <div style={{ fontSize: "9px", color: T.faint, marginTop: "5px" }}>At the cap, the engine drops to observe-only automatically.</div>
          </div>

          <div style={{ fontSize: "10px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: T.fontDisplay, margin: "8px 0 2px" }}>Roster</div>
          {agentMeta.map(([k, name, sub]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ flex: 1 }}><Toggle on={ctrl.agents[k] !== false} onClick={() => toggleAgent(k)} label={name} sub={sub} /></div>
              <button onClick={() => setSelectedAgent(k)} title="Agent detail" style={{ width: "30px", height: "30px", flexShrink: 0, background: T.surface, border: `1px solid ${T.line}`, borderRadius: "8px", color: T.faint, fontSize: "13px", cursor: "pointer" }}>›</button>
            </div>
          ))}
        </div>

        {/* Knowledge feed */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.13em", fontFamily: T.fontDisplay }}>Knowledge & Ideas ({feed.length})</span>
            {feed.length > 0 && <button onClick={() => { kb.clear(); setFeed([]); }} style={{ background: "none", border: "none", color: T.faint, fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>Clear</button>}
          </div>
          {feed.length === 0 ? (
            <EmptyState icon="radar" title="Nothing observed yet" sub="Press play — the roster starts watching your pipeline and logging what it notices, at zero token cost." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {feed.map(e => {
                const col = SEVC[e.signal] || T.faint;
                const isInsight = e.type === "insight";
                return (
                  <div key={e.id} style={{ background: isInsight ? `linear-gradient(135deg, ${T.amber}26 0%, ${T.amber}0D 100%), ${T.surface}` : T.surface, borderRadius: "11px", border: isInsight ? `1px solid ${T.amber}4D` : `1px solid ${T.lineInk}`, borderLeft: `3px solid ${isInsight ? T.amber : col}`, padding: "13px 15px", display: "flex", gap: "12px" }}>
                    <span style={{ fontSize: "9px", fontWeight: 700, color: isInsight ? T.amber : col, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: T.fontDisplay, flexShrink: 0, marginTop: "2px", minWidth: "56px" }}>{isInsight ? "✦ Insight" : TYPE_LABEL[e.type] || "Note"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", color: T.ink, lineHeight: 1.55, fontWeight: isInsight ? 600 : 400 }}>{e.text}</div>
                      {isInsight && e.verified && (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", marginTop: "6px", fontSize: "9px", fontWeight: 700, color: e.verified === "pass" ? T.green : T.amber, background: (e.verified === "pass" ? T.green : T.amber) + "14", padding: "2px 8px", borderRadius: "20px", fontFamily: T.fontDisplay }}>
                          {e.verified === "pass" ? "✓ Verified" : "⚠ Unverified"}{e.confidence != null ? ` · ${e.confidence}%` : ""}
                          {e.verifyNote ? <span style={{ fontWeight: 400, opacity: 0.85 }}>· {e.verifyNote}</span> : null}
                        </div>
                      )}
                      <div style={{ fontSize: "9px", color: T.faint, marginTop: "4px", fontFamily: T.fontMono }}>{e.agent} · {ago(new Date(e.ts).getTime())}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {selectedAgent && <AgentDetail agentKey={selectedAgent} onClose={() => setSelectedAgent(null)} />}
    </div>
  );
}
