// Follow-up cadence rules — ported from santifer/career-ops followup-cadence /
// followup-seed and mapped onto Runway's stages. Pure calendar-day math (no
// business-day logic upstream either), pure functions, smoke-tested.
//
// The escalation ladder that matters: nudge at day 7, second nudge 7 days
// after the first, then COLD — the engine stops suggesting so a dead lead is
// never pestered. A recruiter conversation (phone screen) flips to fast
// cadence: reply next day, then every 3 days. An interview always gets a
// thank-you note the next day.
import { isoDay } from './dates.js';

export const CADENCE = {
  applied_first: 7,        // days after applying → first follow-up
  applied_subsequent: 7,   // days after a completed follow-up → next one
  applied_max: 2,          // completed follow-ups in Applied before going cold
  screen_initial: 1,       // phone screen: respond next day
  screen_subsequent: 3,    // then every 3 days
  interview_thankyou: 1,   // thank-you note the day after an interview stage
};

// an unparseable anchor degrades to `fallback` (same stance as the waiting
// report: bad dates become "today", never a RangeError mid-render)
const addDays = (dateLike, days, fallback = new Date()) => {
  let d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) d = new Date(fallback);
  d.setDate(d.getDate() + days);
  return isoDay(d);
};

const jobFollowUps = (job, followUps) => (followUps || []).filter((f) => f.job_id === job.id);

// Seed-on-Applied: the moment a job enters Applied, schedule the first
// follow-up at applied+7. IDEMPOTENT FOREVER: once ANY follow-up row exists
// for the job (open or done), seeding is a silent no-op — re-marking Applied,
// retries, and back-and-forth stage moves never move a date the user set.
export function seedFollowUp(job, followUps, now = new Date()) {
  if (job.status !== 'applied') return null;
  if (jobFollowUps(job, followUps).length > 0) return null;
  const anchor = job.applied_at || now;
  return {
    job_id: job.id,
    due_date: addDays(anchor, CADENCE.applied_first, now),
    note: 'Follow up on application',
  };
}

// What should the next follow-up be, given where the job is and what's been
// done? Returns { due_date, note } to prefill, { cold: true } when the
// applied-stage ladder is exhausted, or null when the stage has no cadence.
// stageEnteredAt = when the job entered its current stage (from the event
// history); falls back to `now` so a missing history still suggests something
// sane rather than nothing.
export function suggestNextFollowUp(job, followUps, stageEnteredAt = null, now = new Date()) {
  const fus = jobFollowUps(job, followUps);
  const doneDates = fus.filter((f) => f.done && f.done_at).map((f) => new Date(f.done_at)).sort((a, b) => a - b);
  const lastDone = doneDates[doneDates.length - 1] || null;
  const entered = stageEnteredAt ? new Date(stageEnteredAt) : null;

  if (job.status === 'applied') {
    const doneSinceApplied = job.applied_at
      ? doneDates.filter((d) => d >= new Date(job.applied_at)).length
      : doneDates.length;
    if (doneSinceApplied >= CADENCE.applied_max) {
      return { cold: true, reason: `${CADENCE.applied_max} follow-ups sent with no response — let this one rest` };
    }
    const anchor = lastDone || job.applied_at || now;
    return { due_date: addDays(anchor, doneSinceApplied === 0 ? CADENCE.applied_first : CADENCE.applied_subsequent, now), note: doneSinceApplied === 0 ? 'Follow up on application' : 'Second follow-up on application' };
  }
  if (job.status === 'phone_screen') {
    const doneInStage = entered ? doneDates.filter((d) => d >= entered).length : 0;
    const anchor = doneInStage > 0 ? lastDone : (entered || now);
    return {
      due_date: addDays(anchor, doneInStage > 0 ? CADENCE.screen_subsequent : CADENCE.screen_initial, now),
      note: doneInStage > 0 ? 'Check in with the recruiter' : 'Reply to the recruiter / confirm next steps',
    };
  }
  if (job.status === 'interview') {
    return { due_date: addDays(entered || now, CADENCE.interview_thankyou, now), note: 'Send thank-you note' };
  }
  return null;
}
