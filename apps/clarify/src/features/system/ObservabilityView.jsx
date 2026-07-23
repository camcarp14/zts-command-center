import { useState } from "react";
import { T } from "../../theme";
import { AnimatedNumber, EmptyState } from "../../ui.jsx";
import { obs, sm } from "../../lib/store.js";

// ─── Observability View ───────────────────────────────────────────────────────
export function ObservabilityView() {
  const [logs, setLogs] = useState(() => obs.getAll());
  const [filterFn, setFilterFn] = useState("all");
  const [monthlyBudget, setMonthlyBudget] = useState(() => sm.get("ai_budget") || 50);

  const refresh = () => setLogs(obs.getAll());
  const clearLog = () => { obs.clear(); setLogs([]); };
  const saveBudget = (v) => { const n = Math.max(1, parseFloat(v) || 50); setMonthlyBudget(n); sm.set("ai_budget", n); };

  const visible = filterFn === "all" ? logs : logs.filter(l => l.fn === filterFn);
  const sorted = [...visible].sort((a, b) => new Date(b.ts) - new Date(a.ts));

  // Aggregate metrics
  const totalCost = logs.reduce((s, l) => s + (l.costEstimate || 0), 0);
  const totalCalls = logs.length;
  const totalInputTokens = logs.reduce((s, l) => s + (l.inputTokens || 0), 0);
  const totalOutputTokens = logs.reduce((s, l) => s + (l.outputTokens || 0), 0);
  const totalTokens = totalInputTokens + totalOutputTokens;
  const successCount = logs.filter(l => l.ok !== false).length;
  const successRate = totalCalls ? Math.round((successCount / totalCalls) * 100) : 100;
  const latencyLogs = logs.filter(l => l.latencyMs);
  const avgLatency = latencyLogs.length ? Math.round(latencyLogs.reduce((s, l) => s + l.latencyMs, 0) / latencyLogs.length) : 0;
  const budgetPct = Math.min(100, Math.round((totalCost / monthlyBudget) * 100));

  // Per-model breakdown
  const byModel = {};
  logs.forEach(l => {
    const m = l.model || "unknown";
    if (!byModel[m]) byModel[m] = { calls: 0, inTok: 0, outTok: 0, cost: 0 };
    byModel[m].calls++;
    byModel[m].inTok += l.inputTokens || 0;
    byModel[m].outTok += l.outputTokens || 0;
    byModel[m].cost += l.costEstimate || 0;
  });

  // Per-function breakdown
  const byFn = {};
  logs.forEach(l => {
    if (!byFn[l.fn]) byFn[l.fn] = { calls: 0, cost: 0, fails: 0, tokens: 0 };
    byFn[l.fn].calls++;
    byFn[l.fn].cost += l.costEstimate || 0;
    byFn[l.fn].tokens += (l.inputTokens || 0) + (l.outputTokens || 0);
    if (l.ok === false) byFn[l.fn].fails++;
  });

  // Calls over time (last 14 buckets by day)
  const byDay = {};
  logs.forEach(l => {
    const d = new Date(l.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (!byDay[d]) byDay[d] = { calls: 0, cost: 0 };
    byDay[d].calls++;
    byDay[d].cost += l.costEstimate || 0;
  });
  const dayEntries = Object.entries(byDay).slice(-14);
  const dayMaxCalls = Math.max(...dayEntries.map(([, v]) => v.calls), 1);

  const FN_LABELS = {
    analyst_call: "Account Analysis", portfolio_synthesis: "Portfolio Synthesis",
    pre_call_brief: "Pre-Call Brief", generate_draft: "Outreach Draft", global_agent: "Global Agent",
  };
  const MODEL_LABELS = {
    "claude-sonnet-4-6": "Sonnet 4.6", "claude-haiku-4-5-20251001": "Haiku 4.5",
  };
  const MODEL_COLORS = {
    "claude-sonnet-4-6": T.gold, "claude-haiku-4-5-20251001": T.blue,
  };
  const fmtTok = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`;

  return (
    <div style={{ minHeight: "calc(100vh - 48px)", background: "transparent", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay, letterSpacing: "-0.01em" }}>Observability</div>
          <div style={{ fontSize: "11px", color: T.muted, marginTop: "2px" }}>Every Claude call this system makes — tokens, cost, latency, success</div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: T.subtle, border: `1px solid ${T.line}`, borderRadius: "8px" }}>
            <span style={{ fontSize: "10px", color: T.faint, fontFamily: T.fontDisplay, fontWeight: 700 }}>BUDGET $</span>
            <input type="number" value={monthlyBudget} onChange={e => saveBudget(e.target.value)}
              style={{ width: "48px", border: "none", outline: "none", fontSize: "12px", fontFamily: T.fontMono, color: T.ink, background: "transparent" }} />
            <span style={{ fontSize: "10px", color: T.faint }}>/mo</span>
          </div>
          <button onClick={refresh} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${T.line}`, borderRadius: "8px", color: T.muted, fontSize: "11px", cursor: "pointer" }}>↻ Refresh</button>
          <button onClick={clearLog} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${T.red}33`, borderRadius: "8px", color: T.red, fontSize: "11px", cursor: "pointer" }}>Clear</button>
        </div>
      </div>

      {totalCalls === 0 ? (
        <EmptyState icon="chart" title="No calls logged yet" sub="Run an analysis, generate a draft, or ask the global agent — every Claude call shows up here." />
      ) : (
        <>
          {/* Top metric cards */}
          <div className="co-grid5" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px", marginBottom: "14px" }}>
            {[
              { label: "Total Calls", raw: totalCalls, format: (n) => Math.round(n).toLocaleString(), sub: "logged" },
              { label: "Total Tokens", raw: totalTokens, format: fmtTok, sub: `${fmtTok(totalInputTokens)} in · ${fmtTok(totalOutputTokens)} out` },
              { label: "Est. Cost", raw: totalCost, format: (n) => `$${n.toFixed(3)}`, sub: "approximate" },
              { label: "Success Rate", raw: successRate, format: (n) => `${Math.round(n)}%`, sub: `${successCount}/${totalCalls}`, color: successRate < 90 ? T.red : T.green },
              { label: "Avg Latency", raw: avgLatency, format: (n) => n ? `${Math.round(n)}ms` : "—", sub: "per call" },
            ].map((m, i) => (
              <div key={i} style={{ background: T.surface, borderRadius: "10px", border: `1px solid ${T.lineInk}`, padding: "13px 15px", boxShadow: T.shadowCard }}>
                <div style={{ fontSize: "9px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: T.fontDisplay, marginBottom: "6px" }}>{m.label}</div>
                <div style={{ fontSize: "20px", fontWeight: 500, color: m.color || T.ink, fontFamily: T.fontMono, lineHeight: 1 }}><AnimatedNumber value={m.raw} format={m.format} /></div>
                <div style={{ fontSize: "9px", color: T.faint, marginTop: "4px" }}>{m.sub}</div>
              </div>
            ))}
          </div>

          {/* Round 4: guardrails — budget alert + model-routing tip */}
          {(() => {
            const tips = [];
            if (budgetPct >= 90) tips.push({ sev: "critical", text: `AI budget ${budgetPct}% used — $${(monthlyBudget - totalCost).toFixed(2)} left this month. Raise the cap or throttle runs.` });
            else if (budgetPct >= 70) tips.push({ sev: "warning", text: `AI budget ${budgetPct}% used — on pace to exceed if usage holds.` });
            // Model-routing tip: is Sonnet doing routine/high-volume work Haiku could handle?
            const sonnetKey = Object.keys(byModel).find(m => m.includes("sonnet"));
            const haikuKey = Object.keys(byModel).find(m => m.includes("haiku"));
            if (sonnetKey) {
              const s = byModel[sonnetKey];
              const sonnetShare = totalCost > 0 ? s.cost / totalCost : 0;
              // Routine functions that rarely need Sonnet-level reasoning
              const routineOnSonnet = logs.filter(l => (l.model || "").includes("sonnet") && ["generate_draft","pre_call_brief"].includes(l.fn)).length;
              if (sonnetShare > 0.7 && routineOnSonnet >= 3) {
                tips.push({ sev: "info", text: `Sonnet is ${Math.round(sonnetShare*100)}% of spend, and ${routineOnSonnet} routine drafts/briefs ran on it. Routing those to Haiku would cut cost ~3–5× with little quality loss.` });
              }
            }
            if (tips.length === 0) return null;
            const sevColor = { critical: T.red, warning: T.amber, info: T.blue };
            return (
              <div style={{ marginBottom: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {tips.map((t, i) => (
                  <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "12px 14px", background: sevColor[t.sev] + "0D", border: `1px solid ${sevColor[t.sev]}28`, borderRadius: "10px" }}>
                    <span style={{ color: sevColor[t.sev], fontSize: "13px", flexShrink: 0, marginTop: "1px" }}>{t.sev === "critical" ? "⚠" : t.sev === "warning" ? "▲" : "✦"}</span>
                    <span style={{ fontSize: "12px", color: T.muted, lineHeight: 1.55 }}>{t.text}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Budget gauge + token split */}
          <div className="co-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
            <div style={{ background: T.surface, borderRadius: "14px", border: `1px solid ${T.lineInk}`, padding: "18px 20px", boxShadow: T.shadowCard }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>Monthly Budget Usage</span>
                <span style={{ fontSize: "20px", fontWeight: 500, color: budgetPct > 90 ? T.red : budgetPct > 70 ? T.amber : T.green, fontFamily: T.fontMono }}>{budgetPct}%</span>
              </div>
              <div style={{ height: "12px", background: "rgba(255,255,255,0.06)", borderRadius: "6px", overflow: "hidden", marginBottom: "8px" }}>
                <div style={{ width: `${budgetPct}%`, height: "100%", background: budgetPct > 90 ? T.red : budgetPct > 70 ? T.amber : T.green, borderRadius: "6px", transition: "width 0.3s" }} />
              </div>
              <div style={{ fontSize: "11px", color: T.muted }}>${totalCost.toFixed(3)} of ${monthlyBudget} spent · ${Math.max(0, monthlyBudget - totalCost).toFixed(2)} remaining</div>
            </div>

            <div style={{ background: T.surface, borderRadius: "14px", border: `1px solid ${T.lineInk}`, padding: "18px 20px", boxShadow: T.shadowCard }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay, marginBottom: "12px" }}>Token Split</div>
              {(() => {
                const inPct = totalTokens ? Math.round((totalInputTokens / totalTokens) * 100) : 0;
                return (
                  <>
                    <div style={{ display: "flex", height: "12px", borderRadius: "6px", overflow: "hidden", marginBottom: "10px" }}>
                      <div style={{ width: `${inPct}%`, background: T.blue }} title={`Input: ${inPct}%`} />
                      <div style={{ width: `${100 - inPct}%`, background: T.gold }} title={`Output: ${100 - inPct}%`} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                      <span style={{ color: T.blue, fontWeight: 600 }}>● Input {fmtTok(totalInputTokens)} ({inPct}%)</span>
                      <span style={{ color: T.gold, fontWeight: 600 }}>● Output {fmtTok(totalOutputTokens)} ({100 - inPct}%)</span>
                    </div>
                    <div style={{ fontSize: "10px", color: T.muted, marginTop: "8px", lineHeight: 1.5 }}>Output tokens cost 5× input — watch the output share if cost climbs.</div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Per-model breakdown */}
          <div style={{ background: T.surface, borderRadius: "14px", border: `1px solid ${T.lineInk}`, padding: "18px 20px", boxShadow: T.shadowCard, marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay, marginBottom: "14px" }}>By Model</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                  {["Model", "Calls", "Input Tok", "Output Tok", "Cost", "Cost Share"].map((h, hi) => (
                    <th key={hi} style={{ textAlign: hi === 0 ? "left" : "right", padding: "8px 10px", fontSize: "9px", fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: T.fontDisplay }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost).map(([m, s]) => {
                  const share = totalCost ? Math.round((s.cost / totalCost) * 100) : 0;
                  return (
                    <tr key={m} style={{ borderBottom: `1px solid ${T.lineSoft}` }}>
                      <td style={{ padding: "9px 10px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
                          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: MODEL_COLORS[m] || T.muted }} />
                          <span style={{ fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>{MODEL_LABELS[m] || m}</span>
                        </span>
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontFamily: T.fontMono, color: T.muted }}>{s.calls}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontFamily: T.fontMono, color: T.muted }}>{fmtTok(s.inTok)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontFamily: T.fontMono, color: T.muted }}>{fmtTok(s.outTok)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontFamily: T.fontMono, color: T.ink }}>${s.cost.toFixed(4)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontFamily: T.fontMono, color: T.muted }}>{share}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Calls over time */}
          {dayEntries.length > 1 && (
            <div style={{ background: T.surface, borderRadius: "14px", border: `1px solid ${T.lineInk}`, padding: "18px 20px", boxShadow: T.shadowCard, marginBottom: "14px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay, marginBottom: "14px" }}>Activity Over Time</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "100px" }}>
                {dayEntries.map(([day, v], i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }} title={`${day}: ${v.calls} calls, $${v.cost.toFixed(4)}`}>
                    <div style={{ width: "100%", height: `${(v.calls / dayMaxCalls) * 100}%`, background: T.gold, opacity: 0.7, borderRadius: "3px 3px 0 0", minHeight: "3px" }} />
                    <span style={{ fontSize: "8px", color: T.faint, marginTop: "4px", transform: "rotate(-45deg)", whiteSpace: "nowrap", fontFamily: T.fontMono }}>{day}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By function + call log */}
          <div className="co-grid2" style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "14px", alignItems: "start" }}>
            <div style={{ background: T.surface, borderRadius: "12px", border: `1px solid ${T.lineInk}`, padding: "16px", boxShadow: T.shadowCard }}>
              <div style={{ fontSize: "9px", fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.14em", fontFamily: T.fontDisplay, marginBottom: "12px" }}>By Function</div>
              <button onClick={() => setFilterFn("all")}
                style={{ width: "100%", textAlign: "left", padding: "8px 10px", background: filterFn === "all" ? `${T.gold}14` : "transparent", border: "none", borderRadius: "7px", cursor: "pointer", fontSize: "11px", color: filterFn === "all" ? T.gold : T.muted, fontWeight: filterFn === "all" ? 700 : 500, marginBottom: "4px" }}>
                All calls ({totalCalls})
              </button>
              {Object.entries(byFn).sort((a, b) => b[1].cost - a[1].cost).map(([fn, s]) => (
                <button key={fn} onClick={() => setFilterFn(fn)}
                  style={{ width: "100%", textAlign: "left", padding: "8px 10px", background: filterFn === fn ? `${T.gold}14` : "transparent", border: "none", borderRadius: "7px", cursor: "pointer", marginBottom: "2px" }}>
                  <div style={{ fontSize: "11px", color: filterFn === fn ? T.gold : T.ink, fontWeight: filterFn === fn ? 700 : 600 }}>{FN_LABELS[fn] || fn}</div>
                  <div style={{ fontSize: "9px", color: T.faint, marginTop: "2px" }}>{s.calls} calls · {fmtTok(s.tokens)} tok · ${s.cost.toFixed(4)}{s.fails > 0 ? ` · ${s.fails} failed` : ""}</div>
                </button>
              ))}
            </div>

            <div style={{ background: T.surface, borderRadius: "12px", border: `1px solid ${T.lineInk}`, overflow: "hidden", boxShadow: T.shadowCard }}>
              <div style={{ maxHeight: "560px", overflowY: "auto" }}>
                {sorted.slice(0, 100).map((l) => (
                  <div key={l.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${T.lineSoft}`, display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: l.ok === false ? T.red : T.green, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: T.ink, fontFamily: T.fontDisplay }}>{FN_LABELS[l.fn] || l.fn}</div>
                      <div style={{ fontSize: "10px", color: T.faint, marginTop: "1px" }}>{new Date(l.ts).toLocaleString()}</div>
                    </div>
                    {(l.inputTokens != null || l.outputTokens != null) && (
                      <span style={{ fontSize: "9px", color: T.faint, fontFamily: T.fontMono }}>{fmtTok(l.inputTokens || 0)}/{fmtTok(l.outputTokens || 0)}</span>
                    )}
                    <span style={{ fontSize: "10px", color: T.muted, fontFamily: T.fontMono, background: T.subtle, padding: "2px 7px", borderRadius: "6px" }}>{MODEL_LABELS[l.model] || (l.model || "").replace("claude-", "").replace("-20251001", "")}</span>
                    {l.latencyMs != null && <span style={{ fontSize: "10px", color: T.faint, fontFamily: T.fontMono, minWidth: "48px", textAlign: "right" }}>{l.latencyMs}ms</span>}
                    <span style={{ fontSize: "10px", color: T.muted, fontFamily: T.fontMono, minWidth: "58px", textAlign: "right" }}>${(l.costEstimate || 0).toFixed(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
