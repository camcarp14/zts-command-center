import { FLAG_DEFS } from '../lib/score.js';

export function BreakdownBars({ breakdown }) {
  if (!breakdown?.length) return null;
  return (
    <div>
      {breakdown.map((x) => {
        const ratio = x.max ? x.pts / x.max : 0;
        const cls = ratio >= 0.8 ? 'good' : ratio <= 0.34 ? 'bad' : '';
        return (
          <div className="bar-row" key={x.k}>
            <span>{x.label}</span>
            <div className={`bar ${cls}`}><i style={{ width: `${Math.round(ratio * 100)}%` }} /></div>
            <span className="val">{x.pts}/{x.max}</span>
            {x.why && <span className="why">{x.why}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function FlagChips({ flags }) {
  if (!flags?.length) return null;
  return (
    <div className="chips" style={{ marginTop: 10 }}>
      {flags.map((id) => (
        <span key={id} className="chip" title={FLAG_DEFS[id]?.hint || ''}>⚑ {FLAG_DEFS[id]?.label || id}</span>
      ))}
    </div>
  );
}
