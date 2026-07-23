import { describe, it, expect } from "vitest";
import {
  funnelStages, stepPerformance, segmentRates, weeklyTrend, replyMix, timeToReply, headlineStats,
} from "../analytics";

const DAY = 86400000;
const now = new Date("2026-07-10T12:00:00Z");
const ago = (d) => new Date(now.getTime() - d * DAY).toISOString();

const card = (over = {}) => ({
  id: over.id || `c${Math.random()}`, status: "prospected", draft_subject: null, sent_at: null,
  replied_at: null, reply_body: null, reply_classification: null, meeting_at: null,
  prospect: { category: "dentist", city: "Chicago", ads_detected: false },
  created_at: ago(10), updated_at: ago(1), ...over,
});

describe("funnelStages", () => {
  it("counts cumulative reach and excludes rejected", () => {
    const cards = [
      card(),                                                            // prospected only
      card({ status: "draft", draft_subject: "s" }),                     // drafted
      card({ status: "sent", draft_subject: "s", sent_at: ago(5) }),     // sent
      card({ status: "replied", draft_subject: "s", sent_at: ago(6), replied_at: ago(2), reply_body: "hi", reply_classification: "interested" }),
      card({ status: "meeting", draft_subject: "s", sent_at: ago(8), replied_at: ago(4), reply_body: "yes", reply_classification: "scheduling", meeting_at: ago(-1) }),
      card({ status: "rejected" }),                                      // excluded
    ];
    const f = Object.fromEntries(funnelStages(cards).map((s) => [s.key, s.value]));
    expect(f.prospected).toBe(5);
    expect(f.drafted).toBe(4);
    expect(f.sent).toBe(3);
    expect(f.replied).toBe(2);
    expect(f.positive).toBe(2);
    expect(f.meeting).toBe(1);
  });
});

describe("stepPerformance", () => {
  const steps = [
    { id: "s1", step_order: 1, name: "Bump" },
    { id: "s2", step_order: 2, name: "Value-add" },
  ];
  it("attributes a reply to the last send before it", () => {
    const messages = [
      { id: "m1", outreach_id: "o1", direction: "outbound", status: "sent", step_id: null, sent_at: ago(10) },
      { id: "m2", outreach_id: "o1", direction: "outbound", status: "sent", step_id: "s1", sent_at: ago(6) },
      { id: "m3", outreach_id: "o1", direction: "inbound", status: "received", created_at: ago(5) },
    ];
    const rows = stepPerformance({ messages, steps, cards: [] });
    const initial = rows.find((r) => r.step_order === 0);
    const bump = rows.find((r) => r.step_order === 1);
    expect(initial.sent).toBe(1);
    expect(initial.replies).toBe(0);
    expect(bump.sent).toBe(1);
    expect(bump.replies).toBe(1);
    expect(bump.rate).toBe(1);
  });
  it("synthesizes legacy threads from card columns", () => {
    const cards = [card({ id: "o9", sent_at: ago(9), replied_at: ago(7), reply_body: "hello" })];
    const rows = stepPerformance({ messages: [], steps, cards });
    const initial = rows.find((r) => r.step_order === 0);
    expect(initial.sent).toBe(1);
    expect(initial.replies).toBe(1);
  });
});

describe("segmentRates", () => {
  it("computes reply rate per category over sent threads only", () => {
    const cards = [
      card({ status: "sent", sent_at: ago(5) }),
      card({ status: "replied", sent_at: ago(5), replied_at: ago(1), reply_body: "x" }),
      card({ prospect: { category: "hvac", city: "Chicago" }, status: "sent", sent_at: ago(3) }),
      card({ status: "prospected" }), // not sent → excluded
    ];
    const rows = segmentRates(cards, "category");
    const dentist = rows.find((r) => r.segment === "dentist");
    expect(dentist.sent).toBe(2);
    expect(dentist.replied).toBe(1);
    expect(dentist.rate).toBe(0.5);
    expect(rows.find((r) => r.segment === "hvac").rate).toBe(0);
  });
  it("segments by ads dimension", () => {
    const cards = [
      card({ status: "sent", sent_at: ago(2), prospect: { category: "x", ads_detected: true } }),
      card({ status: "sent", sent_at: ago(2), prospect: { category: "x", ads_detected: false } }),
    ];
    const rows = segmentRates(cards, "ads");
    expect(rows.map((r) => r.segment).sort()).toEqual(["No ads", "Running ads"]);
  });
});

describe("weeklyTrend", () => {
  it("buckets sends and replies into weeks", () => {
    const cards = [
      card({ sent_at: ago(2), replied_at: ago(1) }),
      card({ sent_at: ago(9) }),
      card({ sent_at: ago(100) }), // out of window
    ];
    const buckets = weeklyTrend(cards, 8, now);
    expect(buckets).toHaveLength(8);
    expect(buckets[7].sent).toBe(1);
    expect(buckets[7].replies).toBe(1);
    expect(buckets[6].sent).toBe(1);
    expect(buckets.reduce((a, b) => a + b.sent, 0)).toBe(2);
  });
});

describe("replyMix + timeToReply + headlineStats", () => {
  it("orders reply mix by intent and computes median time", () => {
    const cards = [
      card({ status: "replied", sent_at: ago(4), replied_at: ago(3.9), reply_body: "x", reply_classification: "scheduling" }),
      card({ status: "replied", sent_at: ago(4), replied_at: ago(2), reply_body: "x", reply_classification: "not_interested" }),
      card({ status: "replied", sent_at: ago(4), replied_at: ago(1), reply_body: "x" }), // → neutral
    ];
    const mix = replyMix(cards);
    expect(mix[0].key).toBe("scheduling");
    expect(mix.find((m) => m.key === "neutral").value).toBe(1);
    const t = timeToReply(cards);
    expect(t.median).toBeGreaterThan(0);
    expect(t.buckets.reduce((a, b) => a + b.value, 0)).toBe(3);
    const h = headlineStats(cards, [{ status: "active" }, { status: "completed" }]);
    expect(h.responseRate).toBe(1);
    expect(h.activeEnrollments).toBe(1);
  });
});
