// Dashboard metrics — one pure function so the smoke test can plant problems
// (a stale application, a responded pipeline) and assert the numbers.
import { businessDaysBetween, jobIsStale } from './dates.js';

const RESPONSE_STAGES = new Set(['phone_screen', 'interview', 'offer']);

// ---------- pipeline funnel (Insights page) ----------
const FUNNEL_ORDER = ['saved', 'researching', 'applied', 'phone_screen', 'interview', 'offer'];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// How far each job got (ever, via event history), stage-to-stage conversion,
// and median days spent in each stage. Pure — planted-pipeline smoke tested.
export function computeFunnel(jobs, events, now = new Date()) {
  const js = jobs || [];
  const evs = [...(events || [])].sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));
  const idx = (s) => FUNNEL_ORDER.indexOf(s);

  const byJob = new Map();
  for (const e of evs) {
    if (!byJob.has(e.job_id)) byJob.set(e.job_id, []);
    byJob.get(e.job_id).push(e);
  }

  const maxIdxByJob = new Map();
  for (const j of js) {
    let m = idx(j.status);
    for (const e of byJob.get(j.id) || []) m = Math.max(m, idx(e.stage));
    maxIdxByJob.set(j.id, m);
  }
  const reached = FUNNEL_ORDER.map((_, i) => [...maxIdxByJob.values()].filter((v) => v >= i).length);
  const conv = FUNNEL_ORDER.map((_, i) =>
    i + 1 < FUNNEL_ORDER.length && reached[i] > 0 ? Math.round((reached[i + 1] / reached[i]) * 100) : null,
  );

  // days spent per stage visit (ongoing stages measured to `now`)
  const durations = FUNNEL_ORDER.map(() => []);
  for (const j of js) {
    const list = byJob.get(j.id) || [];
    for (let k = 0; k < list.length; k++) {
      const i = idx(list[k].stage);
      if (i < 0) continue;
      const start = new Date(list[k].changed_at);
      const end = k + 1 < list.length ? new Date(list[k + 1].changed_at) : now;
      durations[i].push((end - start) / 86400000);
    }
  }
  const medianDays = durations.map((a) => (a.length ? Math.round(median(a) * 10) / 10 : null));

  return { stages: FUNNEL_ORDER, reached, conv, medianDays };
}

export function computeMetrics(jobs, events, followUps, profile, now = new Date()) {
  const js = jobs || [];
  const evs = events || [];
  const fus = followUps || [];

  const active = js.filter((j) => j.status !== 'closed').length;

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const appliedThisWeek = js.filter((j) => j.applied_at && new Date(j.applied_at) >= weekAgo).length;

  // response rate: of everything ever applied to, how much ever progressed
  // to a live conversation (phone screen or beyond, per the event history)
  const appliedEver = js.filter((j) => j.applied_at);
  const responded = appliedEver.filter((j) => evs.some((e) => e.job_id === j.id && RESPONSE_STAGES.has(e.stage)));
  const responseRate = appliedEver.length ? Math.round((responded.length / appliedEver.length) * 100) : null;

  // last touch per job = most recent COMPLETED follow-up
  const lastTouchByJob = new Map();
  for (const f of fus) {
    if (f.done && f.done_at) {
      const t = new Date(f.done_at);
      const cur = lastTouchByJob.get(f.job_id);
      if (!cur || t > cur) lastTouchByJob.set(f.job_id, t);
    }
  }
  const openFuJobs = new Set(fus.filter((f) => !f.done).map((f) => f.job_id));

  const windowDays = profile?.followup_days ?? 10;
  const staleJobs = js.filter((j) => jobIsStale(j, windowDays, now, lastTouchByJob.get(j.id)));

  // oldest un-followed-up application: sitting in Applied with no follow-up
  // scheduled and none completed since applying
  let oldestUnfollowed = null;
  for (const j of js) {
    if (j.status !== 'applied' || !j.applied_at) continue;
    if (openFuJobs.has(j.id) || lastTouchByJob.has(j.id)) continue;
    const days = businessDaysBetween(j.applied_at, now);
    if (!oldestUnfollowed || days > oldestUnfollowed.days) oldestUnfollowed = { job: j, days };
  }

  return {
    active,
    appliedThisWeek,
    responseRate,
    staleJobs,
    staleIds: new Set(staleJobs.map((j) => j.id)),
    oldestUnfollowed,
    windowDays,
  };
}
