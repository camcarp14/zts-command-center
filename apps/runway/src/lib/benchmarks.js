// Funnel calibration vs published candidate-side benchmarks — ported from
// santifer/career-ops funnel-velocity. Pure functions, no I/O, smoke-tested.
//
// The tone contract is the feature (upstream's tested product decisions):
//  - every benchmark renders with its year and reads as directional, never gospel
//  - below n=20 applications, NO "×typical" multiplier claims — small samples
//    make them statistically indefensible
//  - above-range is NOT generic praise: targeted applications are EXPECTED to
//    beat mass-platform averages (selection bias) — say so
//  - silence is common, not a verdict (the waiting report's framing)
// Employer-side metrics (time-to-fill, pass rates) are deliberately absent:
// their denominators don't match anything a candidate can compute.

export const BENCHMARKS = {
  response_rate: {
    label: 'Response rate',
    range_pct: [2, 13], typical_pct: 3, year: 2025,
    source: 'HiringThing 2025–2026 application statistics; scale.jobs 2025',
    caveat: 'Mass-application platform data; hand-targeted applications should beat this.',
  },
  application_to_interview: {
    label: 'Interview rate',
    range_pct: [2, 4], typical_pct: 3, year: 2026,
    source: 'HiringThing / resutrack 2026 aggregate (~30–40 applications per interview)',
    caveat: 'Mass-application platform data; hand-targeted applications should beat this.',
  },
  days_first_response: {
    label: 'First response',
    range_days: [5, 14], typical_days: 7, year: 2025,
    source: 'Typical ~5 days; 40% of recruiters take >2 weeks. Ghosted applications never enter this denominator.',
  },
};

export const CLAIM_MIN_N = 20; // below this, multiplier claims are suppressed

export const SELECTION_BIAS_NOTE =
  'targeted applications are expected to beat mass-platform averages — this confirms your filtering works';
export const BELOW_RANGE_ACTION =
  'check follow-up compliance on the Board, or revisit your fit threshold on Profile';

// band bounds are INCLUSIVE on both ends (upstream tests pin classify(2) and
// classify(13) as within-range for [2,13])
export const classify = (own, [lo, hi]) =>
  own < lo ? 'below-range' : own > hi ? 'above-range' : 'within-range';

// ownPct vs typical, one decimal (6% vs typical 3% → 2)
export const vsTypical = (own, typical) => Math.round((own / typical) * 10) / 10;

// rows for the Insights calibration card. Rates are percentages or null.
export function computeCalibration({ everApplied, responseRate, interviewRate }) {
  const smallSample = (everApplied || 0) < CLAIM_MIN_N;
  const rows = [];
  const push = (key, own) => {
    const b = BENCHMARKS[key];
    if (own == null) return;
    const band = classify(own, b.range_pct);
    rows.push({
      key, label: b.label, own, band,
      range: b.range_pct, typical: b.typical_pct, year: b.year, source: b.source,
      // no multiplier claims on a small sample — a tested product decision
      multiple: smallSample ? null : vsTypical(own, b.typical_pct),
      note: band === 'above-range' ? SELECTION_BIAS_NOTE
        : band === 'below-range' ? BELOW_RANGE_ACTION
        : null,
    });
  };
  push('response_rate', responseRate);
  push('application_to_interview', interviewRate);
  return { rows, smallSample, n: everApplied || 0 };
}

// In-flight waiting report: everything sitting in Applied, elapsed days since
// the REAL submission date (applied_at; never a created_at stand-in — that's
// the evaluation date and silently corrupts aging), flagged strictly AFTER the
// typical window's upper bound (day 14 itself is not flagged).
export function computeWaiting(jobs, now = new Date()) {
  const [lo, hi] = BENCHMARKS.days_first_response.range_days;
  const items = (jobs || [])
    .filter((j) => j.status === 'applied')
    .map((j) => {
      const raw = j.applied_at ? Math.round((now - new Date(j.applied_at)) / 86400000) : NaN;
      const elapsed = Number.isFinite(raw) ? raw : null; // unparseable date = unknown, never "NaNd"
      return { job: j, elapsedDays: elapsed, beyond: elapsed != null && elapsed > hi };
    })
    .sort((a, b) => (b.elapsedDays ?? -1) - (a.elapsedDays ?? -1));
  return {
    items,
    inFlight: items.length,
    unknownDates: items.filter((x) => x.elapsedDays == null).length,
    window: [lo, hi],
    year: BENCHMARKS.days_first_response.year,
  };
}
