// Business-day math driving the follow-up staleness flag. Pure functions —
// exercised by the planted-problems smoke test.

export function businessDaysBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  if (!(a < b)) return 0;
  let days = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setDate(cur.getDate() + 1);
    const d = cur.getDay();
    if (d !== 0 && d !== 6) days++;
  }
  return days;
}

// A job is stale when it has sat in Applied past the configurable window
// (business days) since the last touch — applying, or the most recent
// completed follow-up, whichever is later.
export function jobIsStale(job, windowDays, now = new Date(), lastTouch = null) {
  if (job.status !== 'applied' || !job.applied_at) return false;
  const anchor = lastTouch && new Date(lastTouch) > new Date(job.applied_at) ? lastTouch : job.applied_at;
  return businessDaysBetween(anchor, now) > (windowDays || 10);
}

// date-only strings ("2026-07-09", e.g. follow-up due dates) must render as
// LOCAL dates — new Date('2026-07-09') parses as UTC midnight and displays a
// day early anywhere west of Greenwich
const parseLocal = (d) =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);

export const fmtDate = (d) =>
  d ? parseLocal(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export const fmtDay = (d) =>
  d ? parseLocal(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export const daysAgo = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

// input[type=date] helper — local date, not UTC-shifted
export const isoDay = (d = new Date()) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
};
