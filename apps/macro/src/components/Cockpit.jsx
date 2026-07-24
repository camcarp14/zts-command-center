// The cockpit: a dashboard, not a document. One glance answers three questions —
// what do I do (the directive), what's the market doing (market reads), where do
// I stand (position). The heavy reasoning is one tap away, never the first thing
// you read: the directive's rationale, the regime facts, and the full run plan
// all live behind "show the work" disclosures so the default view stays a strong,
// scannable dashboard. Every number still wears its freshness; every claim can
// still show its work.
import React, { useState } from 'react'
import { SkPage, Expand, FreshChip } from './primitives.jsx'
import { sizePosition, initialStop } from '../lib/risk.js'
import { fmtPx, round2 } from '../lib/format.js'
import RunPlan from './RunPlan.jsx'

const ACTION_COPY = {
  ENTER: 'Enter long',
  ADD: 'Add to position',
  HOLD: 'Hold',
  TRIM: 'Trim',
  EXIT: 'Exit',
  STOP_OUT: 'STOP OUT',
  STAND_ASIDE: 'Stand aside',
  NO_DATA: 'No data',
}

export default function Cockpit({ derived, settings, position, sources, onReload }) {
  const loading = sources.quote.loading && !sources.quote.data && !sources.quote.error
  if (loading && !derived.price) return <SkPage cards={4} />

  const failing = [
    sources.quote.error && 'MSTR quote',
    sources.btc.error && 'BTC',
    sources.mstr1d.error && 'MSTR history',
    sources.btc1d.error && 'BTC history',
    sources.settingsSrc.error && 'settings',
    sources.positionSrc.error && 'position',
  ].filter(Boolean)

  return (
    <div className="grid stagger" data-testid="cockpit">
      {failing.length > 0 && (
        <div className="error-row span2" role="alert">
          <span>Source trouble: {failing.join(' · ')} — showing what's still trustworthy.</span>
          <button className="btn sm" onClick={onReload}>Retry</button>
        </div>
      )}

      <DirectiveHero derived={derived} />
      <MarketReads derived={derived} settings={settings} />
      {position && <PositionCard derived={derived} position={position} />}
      <EntryPlanner derived={derived} settings={settings} hasPosition={!!position} />
      <RunPlanDisclosure derived={derived} settings={settings} position={position} />
    </div>
  )
}

/** The hero: the one call, big. Headline + guardrails stay visible; the bullet
 *  rationale (the old wall of text) collapses behind "why this call". */
function DirectiveHero({ derived }) {
  const d = derived.directive
  const [why, setWhy] = useState(false)
  return (
    <section className={`card directive span2 ${d.severity}`} data-testid="directive">
      <div className="ttl">Directive
        <span className="spacer" />
        <FreshChip fresh={derived.freshQuote} label="MSTR" />
        <FreshChip fresh={derived.freshBtc} label="BTC" />
      </div>
      <div className="action" data-testid="directive-action">{ACTION_COPY[d.action] ?? d.action}</div>
      <p className="sub" style={{ marginTop: 4, fontSize: 14.5 }}>{d.headline}</p>
      {d.guardrails.map((g, i) => (
        <div className="guardrail" key={i}><span aria-hidden>⚠︎</span><span>{g}</span></div>
      ))}
      {d.reasons?.length > 0 && (
        <>
          <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setWhy((w) => !w)} aria-expanded={why}>
            {why ? 'hide the reasoning' : 'why this call'}
          </button>
          <Expand open={why}>
            <ul>{d.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </Expand>
        </>
      )}
    </section>
  )
}

/** The market at a glance — regime + BTC confirmation as badges, leverage truth
 *  as tiles. One card replaces the two regime cards and the torque card; the
 *  supporting facts stay available behind "show the work". */
function MarketReads({ derived, settings }) {
  const [open, setOpen] = useState(false)
  const { regime, btcAlign, torqueRead, beta, nav, rs, pullback, breakout } = derived
  const seeded = settings?.btcHoldingsSeeded || settings?.sharesSeeded
  const facts = [...regime.facts, ...(pullback?.facts ?? []), ...(breakout?.facts ?? []), ...btcAlign.facts]
  return (
    <section className="card span2" data-testid="market-reads">
      <div className="ttl">Market reads
        <span className="spacer" />
        <FreshChip fresh={derived.freshCandles} label="MSTR" />
        <FreshChip fresh={derived.freshBtcCandles} label="BTC" />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className={`badge-regime ${regime.state}`}>MSTR {regime.state.replace('_', ' ')}{regime.score != null ? ` ${regime.score}` : ''}</span>
        <span className={`badge-regime ${btcAlign.state}`}>BTC {btcAlign.state.replace('_', ' ')}{btcAlign.score != null ? ` ${btcAlign.score}` : ''}</span>
        <span className={`chip grade-${torqueRead.grade}`}>leverage · {torqueRead.grade}</span>
        {pullback?.stage === 'trigger' && <span className="chip live"><span className="dot" />pullback trigger</span>}
        {breakout?.active && <span className="chip live"><span className="dot" />breakout {fmtPx(breakout.level)}</span>}
      </div>

      <div className="stats">
        <div className="stat"><div className="k">Beta vs BTC</div><div className="v num">{beta == null ? '—' : `${round2(beta)}×`}</div><div className="d">30-day daily</div></div>
        <div className="stat"><div className="k">mNAV</div><div className="v num">{nav?.mNav == null ? '—' : `${nav.mNav}×`}</div><div className="d">{nav?.premiumPct == null ? 'premium' : `${nav.premiumPct >= 0 ? '+' : ''}${round2(nav.premiumPct)}% prem`}</div></div>
        <div className="stat"><div className="k">20d RS</div><div className={`v num ${rs?.spreadPct == null ? '' : rs.spreadPct >= 0 ? 'pos' : 'neg'}`}>{rs?.spreadPct == null ? '—' : `${rs.spreadPct >= 0 ? '+' : ''}${round2(rs.spreadPct)}pp`}</div><div className="d">MSTR − BTC</div></div>
        <div className="stat"><div className="k">Implied BTC</div><div className="v num">{nav?.impliedBtcPrice == null ? '—' : `$${nav.impliedBtcPrice.toLocaleString('en-US')}`}</div><div className="d">price via MSTR</div></div>
      </div>

      <p className="sub" style={{ marginTop: 10 }}>{torqueRead.text}</p>
      {seeded && (
        <div className="guardrail"><span aria-hidden>⚠︎</span><span>
          BTC holdings / share count are SEEDED estimates (as of {settings.btcHoldingsAsOf}) — verify against the latest 8-K in Settings; mNAV is only as honest as those two numbers.
        </span></div>
      )}
      {facts.length > 0 && (
        <>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'hide the work' : 'show the work'}
          </button>
          <Expand open={open}>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {facts.map((f, i) => <li key={i} className="sub" style={{ margin: '3px 0' }}>{f}</li>)}
            </ul>
          </Expand>
        </>
      )}
    </section>
  )
}

/** The full run plan — radar, battle plan, thesis breaks — kept out of the
 *  default glance and revealed on demand, so the cockpit leads with state, not
 *  a wall of checklists. The armed/trigger signals themselves already surface as
 *  chips in Market reads. */
function RunPlanDisclosure({ derived, settings, position }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="span2" data-testid="run-plan-disclosure">
      <button
        className="btn ghost"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border)' }}
      >
        <span style={{ fontWeight: 700 }}>Run plan &amp; tickets</span>
        <span className="tiny">{open ? 'hide ▾' : 'the radar, battle plan & thesis breaks ▸'}</span>
      </button>
      <Expand open={open}>
        <div className="grid" style={{ marginTop: 12 }}>
          <RunPlan derived={derived} settings={settings} position={position} />
        </div>
      </Expand>
    </div>
  )
}

function PositionCard({ derived, position }) {
  const { posDerived, price } = derived
  const r = posDerived?.r
  const eff = posDerived?.effStop
  const unrealized = Number.isFinite(price) ? (price - position.avgEntry) * position.shares : null
  const distPct = Number.isFinite(eff) && Number.isFinite(price) && price > 0 ? ((price - eff) / price) * 100 : null
  const meterCls = distPct == null ? '' : distPct < 3 ? 'danger' : distPct < 6 ? 'warn' : ''
  const initialRiskPct = position.avgEntry > 0 ? ((position.avgEntry - position.initialStop) / position.avgEntry) * 100 : null

  return (
    <section className="card" data-testid="position-card">
      <div className="ttl">Open position</div>
      <div className="big num">{position.shares} <span className="sub" style={{ fontSize: 14 }}>MSTR @ {fmtPx(position.avgEntry)}</span></div>
      <div className="stats" style={{ marginTop: 10 }}>
        <div className="stat"><div className="k">Open R</div><div className={`v num ${r == null ? '' : r >= 0 ? 'pos' : 'neg'}`} data-testid="open-r">{r == null ? '—' : `${r >= 0 ? '+' : ''}${round2(r)}R`}</div></div>
        <div className="stat"><div className="k">Unrealized</div><div className={`v num ${unrealized == null ? '' : unrealized >= 0 ? 'pos' : 'neg'}`}>{unrealized == null ? '—' : `${unrealized < 0 ? '-' : ''}$${Math.abs(Math.round(unrealized)).toLocaleString('en-US')}`}</div></div>
        <div className="stat"><div className="k">Stop now</div><div className="v num">{eff == null ? '—' : fmtPx(eff)}</div><div className="d">{trailNote(position, posDerived)}</div></div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="tiny" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>distance to stop</span><span className="num">{distPct == null ? '—' : `${round2(distPct)}%`}</span>
        </div>
        <div className={`meter ${meterCls}`} role="img" aria-label={distPct == null ? 'stop distance unknown' : `price is ${round2(distPct)} percent above the stop`}>
          <div style={{ width: `${distPct == null ? 0 : Math.max(4, Math.min(100, distPct * 8))}%` }} />
        </div>
        <div className="tiny" style={{ marginTop: 6 }}>
          initial risk {initialRiskPct == null ? '—' : `${round2(initialRiskPct)}%`} of entry · stop only ever rises
        </div>
      </div>
    </section>
  )
}

function trailNote(position, pd) {
  if (!pd) return 'initial stop'
  if (pd.trailNow != null && pd.effStop === pd.trailNow) return 'chandelier trail'
  if (Number.isFinite(position.stopOverride) && pd.effStop === position.stopOverride) return 'manual override'
  if (Number.isFinite(position.stopHighWater) && pd.effStop === position.stopHighWater) return 'ratchet high-water'
  if (pd.effStop === position.avgEntry) return 'breakeven lock'
  return 'initial stop'
}

/** "If you enter now" — live sizing with editable stop mode. The discipline
 *  widget: change the mode, watch shares and risk recompute. Defers
 *  (collapses) once a position is known — position data arrives after
 *  mount, so sync until the user takes over the toggle. */
function EntryPlanner({ derived, settings, hasPosition }) {
  const [mode, setMode] = useState(null)
  const [open, setOpen] = useState(!hasPosition)
  const userToggled = React.useRef(false)
  React.useEffect(() => {
    if (!userToggled.current) setOpen(!hasPosition)
  }, [hasPosition])
  if (!settings) return null
  const effMode = mode ?? settings.stopMode
  const price = derived.price
  const plan = price != null
    ? initialStop({ mode: effMode, entry: price, atr: derived.atrNow, atrMult: settings.atrMult, swingLow: derived.lastSwingLow, pct: settings.stopPct })
    : null
  const sz = plan?.stop != null
    ? sizePosition({ equity: settings.equity, riskPct: settings.riskPct, entry: price, stop: plan.stop, maxPositionPct: settings.maxPositionPct })
    : null

  return (
    <section className="card" data-testid="entry-planner">
      <div className="ttl">If you enter now
        <span className="spacer" />
        <button className="btn ghost sm" onClick={() => { userToggled.current = true; setOpen((o) => !o) }} aria-expanded={open}>{open ? 'collapse' : 'expand'}</button>
      </div>
      <Expand open={open}>
        <div className="seg" style={{ marginBottom: 12 }}>
          {['atr', 'structure', 'percent'].map((m) => (
            <button key={m} className={effMode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'atr' ? `ATR ×${settings.atrMult}` : m === 'structure' ? 'Swing low' : `${settings.stopPct}%`}</button>
          ))}
        </div>
        {price == null ? (
          <div className="empty"><div className="glyph">—</div>No live price to plan against.</div>
        ) : plan?.stop == null ? (
          <div className="empty">Stop can't be computed: {plan?.detail ?? 'no data'} <span className="tiny">({plan?.warning})</span></div>
        ) : (
          <>
            <div className="stats">
              <div className="stat"><div className="k">Buy</div><div className="v num" data-testid="plan-shares">{sz?.ok ? `${sz.shares} sh` : '—'}</div><div className="d">≈ ${sz?.ok ? Math.round(sz.positionUsd).toLocaleString('en-US') : '—'}</div></div>
              <div className="stat"><div className="k">Stop</div><div className="v num">{fmtPx(plan.stop)}</div><div className="d">{plan.detail}</div></div>
              <div className="stat"><div className="k">Risk</div><div className="v num">{sz?.ok ? `$${Math.round(sz.riskUsd).toLocaleString('en-US')}` : '—'}</div><div className="d">{settings.riskPct}% of equity{sz?.capped ? ' · CAPPED' : ''}</div></div>
              <div className="stat"><div className="k">Position</div><div className="v num">{sz?.ok ? `${sz.positionPct}%` : '—'}</div><div className="d">max {settings.maxPositionPct}%</div></div>
            </div>
            {!sz?.ok && sz?.error && <div className="guardrail"><span>⚠︎</span><span>{sizingErrorCopy(sz.error)}</span></div>}
            <p className="tiny" style={{ marginTop: 10 }}>
              Advisory only — place orders at your broker. A stop is a decision made now, not in the moment.
            </p>
          </>
        )}
      </Expand>
    </section>
  )
}

function sizingErrorCopy(code) {
  return {
    risk_too_small_for_one_share: 'Your risk budget doesn\'t buy one whole share at this stop distance — widen risk % or wait for a tighter setup.',
    stop_not_below_entry: 'Computed stop is not below the entry price.',
    bad_input: 'Sizing inputs incomplete.',
  }[code] ?? code
}
