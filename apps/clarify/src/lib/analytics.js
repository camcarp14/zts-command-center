// ─── Pipeline analytics — pure aggregation functions ─────────────────────────
// Everything here takes plain rows in and returns chart-ready series out; the
// AnalyticsView is a thin renderer over these. All functions are unit-tested.
import { estimateValue } from "./leads.js";
import { withLegacyBridge } from "./threadBridge.js";

// Chart series palette — validated for the dark surface (#141B2C) with the
// dataviz six-checks script (lightness band, chroma, CVD ΔE≥12, contrast).
// UI tokens are brighter than the chart band on purpose; marks use these.
// Fixed assignment order — never cycled, never repainted on filter.
export const CHART_SERIES = ["#B08F42", "#4C8DFF", "#DB4E96", "#8B6CF0"];
export const CHART_SEQ_BRASS = ["#5C4A1F", "#7A6329", "#977B33", "#B08F42", "#C4A45C"]; // light→dark reversed for dark mode: darkest…brightest

const POSITIVE = new Set(["interested", "scheduling"]);

// ── Funnel: how far each thread has traveled ─────────────────────────────────
// Stages are cumulative ("reached at least"): a meeting implies replied+sent.
export function funnelStages(cards = []) {
  const reached = { prospected: 0, drafted: 0, sent: 0, replied: 0, positive: 0, meeting: 0 };
  for (const c of cards) {
    if (["rejected"].includes(c.status)) continue; // dead leads don't advance the live funnel
    reached.prospected++;
    const drafted = !!c.draft_subject || ["draft", "draft_ready", "sent", "replied", "meeting", "approved"].includes(c.status);
    if (drafted) reached.drafted++;
    const sent = !!c.sent_at || ["sent", "replied", "meeting"].includes(c.status);
    if (sent) reached.sent++;
    const replied = !!c.replied_at || !!c.reply_body || ["replied", "meeting"].includes(c.status);
    if (replied) reached.replied++;
    if (replied && POSITIVE.has(c.reply_classification)) reached.positive++;
    if (c.meeting_at || c.status === "meeting") reached.meeting++;
  }
  return [
    { key: "prospected", label: "Prospected", value: reached.prospected },
    { key: "drafted", label: "Drafted", value: reached.drafted },
    { key: "sent", label: "Sent", value: reached.sent },
    { key: "replied", label: "Replied", value: reached.replied },
    { key: "positive", label: "Positive", value: reached.positive },
    { key: "meeting", label: "Meeting", value: reached.meeting },
  ];
}

// ── Sequence step performance ────────────────────────────────────────────────
// A reply is attributed to the LAST outbound send before it in the thread.
// Legacy threads (initial send only on outreach.sent_at) attribute to step 0.
export function stepPerformance({ messages = [], steps = [], cards = [] }) {
  const byThread = new Map();
  for (const m of messages) {
    if (!byThread.has(m.outreach_id)) byThread.set(m.outreach_id, []);
    byThread.get(m.outreach_id).push(m);
  }
  // Legacy threads read through the SAME bridge the engine uses (threadBridge.js).
  for (const c of cards) {
    if (!c.sent_at) continue;
    byThread.set(c.id, withLegacyBridge(c, byThread.get(c.id) || []));
  }

  const stepById = new Map(steps.map((s) => [s.id, s]));
  const rows = new Map(); // step_order → {sent, replies}
  const rowFor = (order, name) => {
    if (!rows.has(order)) rows.set(order, { step_order: order, name, sent: 0, replies: 0 });
    return rows.get(order);
  };

  for (const thread of byThread.values()) {
    const outbound = thread
      .filter((m) => m.direction === "outbound" && m.status === "sent" && m.sent_at)
      .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
    const inbound = thread
      .filter((m) => m.direction === "inbound")
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (const o of outbound) {
      const step = o.step_id ? stepById.get(o.step_id) : null;
      const order = step ? step.step_order : 0;
      rowFor(order, step ? step.name : "Initial").sent++;
    }
    for (const r of inbound) {
      const before = outbound.filter((o) => new Date(o.sent_at) <= new Date(r.created_at));
      const attributed = before[before.length - 1];
      if (!attributed) continue;
      const step = attributed.step_id ? stepById.get(attributed.step_id) : null;
      const order = step ? step.step_order : 0;
      rowFor(order, step ? step.name : "Initial").replies++;
    }
  }
  return [...rows.values()].sort((a, b) => a.step_order - b.step_order)
    .map((r) => ({ ...r, rate: r.sent ? r.replies / r.sent : 0 }));
}

// ── Response rate by segment ─────────────────────────────────────────────────
export function segmentRates(cards = [], dimension = "category") {
  const keyFor = (c) => {
    if (dimension === "category") return c.prospect?.category || "unknown";
    if (dimension === "city") return c.prospect?.city || "unknown";
    if (dimension === "ads") return c.prospect?.ads_detected ? "Running ads" : "No ads";
    if (dimension === "value") return estimateValue(c).label;
    return "all";
  };
  const groups = new Map();
  for (const c of cards) {
    const sent = !!c.sent_at || ["sent", "replied", "meeting"].includes(c.status);
    if (!sent) continue;
    const k = keyFor(c);
    if (!groups.has(k)) groups.set(k, { segment: k, sent: 0, replied: 0 });
    const g = groups.get(k);
    g.sent++;
    if (c.replied_at || c.reply_body || ["replied", "meeting"].includes(c.status)) g.replied++;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rate: g.sent ? g.replied / g.sent : 0 }))
    .sort((a, b) => b.sent - a.sent);
}

// ── Weekly send/reply trend ──────────────────────────────────────────────────
export function weeklyTrend(cards = [], weeks = 8, now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - weeks * 7);
  const bucketOf = (d) => Math.floor((new Date(d) - start) / (7 * 86400000));
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const from = new Date(start.getTime() + i * 7 * 86400000);
    return { label: `${from.getMonth() + 1}/${from.getDate()}`, sent: 0, replies: 0 };
  });
  for (const c of cards) {
    if (c.sent_at) {
      const b = bucketOf(c.sent_at);
      if (b >= 0 && b < weeks) buckets[b].sent++;
    }
    if (c.replied_at) {
      const b = bucketOf(c.replied_at);
      if (b >= 0 && b < weeks) buckets[b].replies++;
    }
  }
  return buckets;
}

// ── Reply mix by classification ──────────────────────────────────────────────
export function replyMix(cards = []) {
  const counts = {};
  for (const c of cards) {
    const replied = c.replied_at || c.reply_body || ["replied", "meeting"].includes(c.status);
    if (!replied) continue;
    const k = c.reply_classification || "neutral";
    counts[k] = (counts[k] || 0) + 1;
  }
  const ORDER = ["scheduling", "interested", "question", "objection", "neutral", "not_interested"];
  return ORDER.filter((k) => counts[k]).map((k) => ({ key: k, value: counts[k] }));
}

// ── Time to reply ────────────────────────────────────────────────────────────
export function timeToReply(cards = []) {
  const hours = cards
    .filter((c) => c.sent_at && c.replied_at)
    .map((c) => (new Date(c.replied_at) - new Date(c.sent_at)) / 3600000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  if (hours.length === 0) return { median: null, buckets: [] };
  const median = hours[Math.floor(hours.length / 2)];
  const defs = [
    { label: "< 4h", max: 4 }, { label: "4–24h", max: 24 },
    { label: "1–3d", max: 72 }, { label: "3–7d", max: 168 }, { label: "> 7d", max: Infinity },
  ];
  const buckets = defs.map((d) => ({ label: d.label, value: 0 }));
  for (const h of hours) {
    const i = defs.findIndex((d) => h < d.max);
    buckets[i === -1 ? defs.length - 1 : i].value++;
  }
  return { median, buckets };
}

// ── Headline stats ───────────────────────────────────────────────────────────
export function headlineStats(cards = [], enrollments = []) {
  const f = Object.fromEntries(funnelStages(cards).map((s) => [s.key, s.value]));
  return {
    responseRate: f.sent ? f.replied / f.sent : 0,
    positiveRate: f.replied ? f.positive / f.replied : 0,
    meetings: f.meeting,
    sent: f.sent,
    replied: f.replied,
    activeEnrollments: enrollments.filter((e) => e.status === "active").length,
  };
}
