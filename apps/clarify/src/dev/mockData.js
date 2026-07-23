// ─── Mock fixtures — deterministic data for every view ───────────────────────
// Dates are relative to "now" so due/overdue states render live. Shapes mirror
// db/schema.sql exactly; ids are stable strings so screenshots are comparable.
const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

const P = (i, over = {}) => ({
  id: `p${i}`, business_name: over.business_name, address: `${100 + i} W Example St, Chicago, IL`,
  website: over.website || `https://${(over.business_name || "biz").toLowerCase().replace(/[^a-z]+/g, "")}.example.com`,
  phone: `(312) 555-01${String(i).padStart(2, "0")}`, category: over.category || "dentist",
  google_place_id: `gplace-${i}`, city: over.city || "Chicago", ads_detected: over.ads_detected ?? false,
  ads_check_at: iso(2), prospected_at: iso(over.age ?? 6), created_at: iso(over.age ?? 6),
  website_context: over.ctx || null, prospect_brief: over.brief || null,
  brief_callouts: over.callouts ? JSON.stringify(over.callouts) : null,
  linkedin_url: null, marketing_signals: over.signals ? JSON.stringify(over.signals) : null, screenshot_url: null,
  ...over,
});

export function makeFixtures() {
  const prospects = [
    P(1, { business_name: "Lakeview Dental Studio", category: "dentist", ads_detected: true, age: 9, brief: "Runs Google Ads on branded terms only; no sitelinks; strong reviews (4.8★, 320+).", callouts: ["Branded-only campaign", "No call extensions", "Competitor bidding on their name"] }),
    P(2, { business_name: "North Shore HVAC Co", category: "hvac", ads_detected: true, age: 8, signals: { ga4: true, gtm: true, google_ads_pixel: true } }),
    P(3, { business_name: "Wicker Park Physio", category: "physical therapy", age: 7 }),
    P(4, { business_name: "Gold Coast Estate Law", category: "law firm", ads_detected: true, age: 6, brief: "High-CPC vertical; landing page is the homepage; no conversion tracking detected." }),
    P(5, { business_name: "Logan Square Vet Clinic", category: "veterinarian", age: 5 }),
    P(6, { business_name: "Riverwalk Roofing", category: "roofing", ads_detected: false, age: 5 }),
    P(7, { business_name: "Fulton Market Fitness", category: "gym", age: 4 }),
    P(8, { business_name: "Andersonville Orthodontics", category: "dentist", ads_detected: true, age: 3 }),
    P(9, { business_name: "West Loop Injury Attorneys", category: "law firm", ads_detected: true, age: 2, city: "Chicago" }),
    P(10, { business_name: "Evanston Plumbing Pros", category: "plumber", age: 1, city: "Evanston" }),
  ];
  const contacts = prospects.map((p, idx) => ({
    id: `c${idx + 1}`, prospect_id: p.id,
    name: ["Dana Whitfield", "Marcus Lee", "Priya Raman", "Tom Kowalski", "Elena Voss", "Sam Ortiz", "Jordan Park", "Aisha Bell", "Nick Ferraro", "Maya Chen"][idx],
    email: `owner@${(p.business_name || "").toLowerCase().replace(/[^a-z]+/g, "")}.example.com`,
    email_confidence_score: 92 - idx * 4, email_verified: idx % 3 !== 2, source: idx % 4 === 3 ? "guessed" : "hunter",
    created_at: p.created_at,
  }));

  const O = (i, pi, status, over = {}) => ({
    id: `o${i}`, prospect_id: `p${pi}`, contact_id: `c${pi}`, status,
    draft_subject: over.draft_subject ?? null, draft_body: over.draft_body ?? null,
    tone_feedback: null, rejection_reason: null, approved_at: null, rejected_at: null,
    created_at: iso(over.age ?? 5), updated_at: iso(0.5),
    sent_at: over.sent_at ?? null, gmail_message_id: over.sent_at ? `gm-${i}` : null,
    gmail_thread_id: over.sent_at ? `th-${i}` : null, gmail_rfc_message_id: over.sent_at ? `<rfc-${i}@mail.gmail.com>` : null,
    follow_up_count: over.follow_up_count ?? 0, next_follow_up_at: null,
    replied_at: over.replied_at ?? null, reply_snippet: null,
    reply_body: over.reply_body ?? null, reply_from: over.reply_from ?? null,
    reply_subject: over.reply_subject ?? null, reply_gmail_message_id: over.replied_at ? `gmr-${i}` : null,
    reply_draft: over.reply_draft ?? null, reply_draft_subject: over.reply_draft ? `Re: ${over.reply_subject || "your note"}` : null,
    meeting_at: over.meeting_at ?? null, meeting_outcome: over.meeting_outcome ?? null, meeting_note: null,
    reply_classification: over.reply_classification ?? null,
    reply_classification_confidence: over.reply_classification ? 0.9 : null,
    reply_classification_source: over.reply_classification ? "ai" : null,
    ...over.extra,
  });

  const outreach = [
    O(1, 1, "replied", {
      age: 9, sent_at: iso(6), replied_at: iso(0.3),
      draft_subject: "Your branded campaign is leaving money on the table",
      draft_body: "Hi Dana — noticed Lakeview's ads only show on your own name…",
      reply_from: "Dana Whitfield <owner@lakeviewdental.example.com>",
      reply_subject: "Re: Your branded campaign",
      reply_body: "This is interesting — when could we talk this week? Wednesday afternoon works on my end.",
      reply_classification: "scheduling",
      reply_draft: "Hi Dana — Wednesday works. Here's my booking link, grab whatever slot suits:",
    }),
    O(2, 2, "replied", {
      age: 8, sent_at: iso(5), replied_at: iso(0.8),
      draft_subject: "North Shore's ads vs. the Comfort Kings budget",
      draft_body: "Hi Marcus — your competitors are outbidding you on 'emergency furnace repair'…",
      reply_from: "Marcus Lee <owner@northshorehvac.example.com>",
      reply_subject: "Re: North Shore's ads",
      reply_body: "We already have an agency handling this and honestly the retainers feel steep. Why would you be different?",
      reply_classification: "objection",
      reply_draft: "Fair question, Marcus. Two concrete differences: weekly query-level pruning and no 12-month lock-in…",
    }),
    O(3, 4, "replied", {
      age: 6, sent_at: iso(4), replied_at: iso(1.2),
      draft_subject: "Gold Coast Estate Law — conversion tracking gap",
      draft_body: "Hi Tom — your ads point at the homepage with no tracking…",
      reply_from: "Tom Kowalski <owner@goldcoastestatelaw.example.com>",
      reply_subject: "Re: conversion tracking",
      reply_body: "Not interested, please remove me from your list.",
      reply_classification: "not_interested",
    }),
    O(4, 8, "sent", { age: 3, sent_at: iso(4), draft_subject: "Andersonville Ortho — Invisalign query costs", draft_body: "Hi Aisha — quick observation about your Invisalign campaigns…" }),
    O(5, 9, "sent", { age: 2, sent_at: iso(8), draft_subject: "West Loop Injury — auction insights", draft_body: "Hi Nick — you dropped out of the top-3 auction slots this month…" }),
    O(6, 5, "sent", { age: 5, sent_at: iso(1), draft_subject: "Logan Square Vet — Sunday search spike", draft_body: "Hi Elena — searches for emergency vet spike Sundays; your ads are dark then…" }),
    O(7, 3, "draft", { age: 7, draft_subject: "Wicker Park Physio — dry needling searches up 40%", draft_body: "Hi Priya — demand for dry needling in your zip is up 40% YoY…" }),
    O(8, 6, "draft", { age: 5, draft_subject: "Riverwalk Roofing — storm-season head start", draft_body: "Hi Sam — hail season starts in six weeks; the smart money locks CPCs now…" }),
    O(9, 7, "prospected", { age: 4 }),
    O(10, 10, "prospected", { age: 1 }),
    O(11, 1, "meeting", {
      age: 12, sent_at: iso(10), replied_at: iso(8), meeting_at: iso(-2), meeting_outcome: "pending",
      draft_subject: "Intro — Clarify Paid Search", draft_body: "…", reply_body: "Sure, let's meet.",
      reply_from: "Dana Whitfield <owner@lakeviewdental.example.com>", reply_subject: "Re: Intro", reply_classification: "interested",
      extra: { prospect_id: "p1", contact_id: "c1" },
    }),
  ];

  const inbound_leads = [
    { id: "il1", created_at: iso(0.2), name: "Rachel Kim", business: "Bucktown Bakery", website: "https://bucktownbakery.example.com", monthly_spend: "$1,000–$3,000", service: "Google Ads management", details: "We're spending on ads but can't tell what's working. Need help before holiday season.", source: "clarify_paid_search_site", status: "new", pipeline_prospect_id: null, raw: {}, email: "rachel@bucktownbakery.example.com" },
    { id: "il2", created_at: iso(1.5), name: "Devon Carter", business: "Carter Moving Co", website: "https://cartermoving.example.com", monthly_spend: "Under $1,000", service: "Free audit", details: "Audit tool said we're missing conversion tracking — want the full picture.", source: "free_audit", status: "new", pipeline_prospect_id: null, raw: {}, email: "devon@cartermoving.example.com" },
    { id: "il3", created_at: iso(4), name: "Sofia Reyes", business: "Reyes Family Dental", website: "https://reyesdental.example.com", monthly_spend: "$3,000–$5,000", service: "Google Ads management", details: "Current agency underperforming.", source: "clarify_paid_search_site", status: "reviewed", pipeline_prospect_id: "p1", raw: {}, email: "sofia@reyesdental.example.com" },
  ];

  const tone_memory = [
    { id: "tm1", feedback_text: "Shorter openers — one observation, one question. No 'I hope this finds you well.'", applied_to_outreach_id: "o1", created_at: iso(6) },
    { id: "tm2", feedback_text: "Always name the specific campaign or keyword we noticed — no generic claims.", applied_to_outreach_id: "o2", created_at: iso(3) },
  ];

  const clients = [
    { id: "cl1", user_id: "mock-user", name: "Reyes Family Dental", google_ads_customer_id: "123-456-7890", monthly_budget: 4000, cpa_target: 85, roas_target: null, primary_conversion: "Booked appointment", industry: "dental", status: "active", notes: "Converted from inbound lead.", created_at: iso(20), updated_at: iso(1) },
    { id: "cl2", user_id: "mock-user", name: "North Side Auto Glass", google_ads_customer_id: "987-654-3210", monthly_budget: 2500, cpa_target: 40, roas_target: null, primary_conversion: "Phone call", industry: "auto services", status: "active", notes: "", created_at: iso(45), updated_at: iso(2) },
  ];
  const findings = [
    { id: "f1", client_id: "cl1", snapshot_id: null, created_at: iso(0.6), type: "cpa_anomaly", severity: "critical", title: "CPA up 38% week-over-week", diagnosis: "Broad-match expansion added 214 junk queries; spend shifted off exact winners.", recommendation: "Add 12 negatives (list attached), revert tCPA to $85.", supporting_data: {}, confidence: 0.9, status: "active", deck_id: null, acknowledged_at: null, resolved_at: null },
    { id: "f2", client_id: "cl2", snapshot_id: null, created_at: iso(1.4), type: "budget_pacing", severity: "warning", title: "Budget pacing at 71%", diagnosis: "Daily caps throttling weekend coverage.", recommendation: "Shift 15% of Mon–Thu budget to Fri–Sun.", supporting_data: {}, confidence: 0.82, status: "active", deck_id: null, acknowledged_at: null, resolved_at: null },
  ];
  const action_queue = [
    { id: "aq1", client_id: "cl1", finding_id: "f1", created_at: iso(0.6), action_type: "add_negative_keyword", description: "Add 12 negative keywords to 'Dental - Core'", rationale: "Junk queries from broad expansion", impact_estimate: "-$430/mo wasted spend", estimated_cpa_change: -12, estimated_spend_change: -430, payload: {}, requires_approval: true, status: "pending", approved_at: null, approved_by: null, executed_at: null, execution_result: null, outcome_measured_at: null, outcome_data: null },
  ];

  // Phase 3 tables — pre-seeded so sequence UI work can be driven in mock mode.
  const sequences = [{ id: "seq1", name: "Standard outreach", description: "Bump 3d → value-add 7d → break-up 14d", is_active: true, stop_on_reply: true, created_at: iso(30), updated_at: iso(2) }];
  const sequence_steps = [
    { id: "st1", sequence_id: "seq1", step_order: 1, name: "Bump", wait_days: 3, send_condition: "no_reply", subject_template: null, body_template: "Short nudge — make sure the first note didn't get buried.", ai_personalize: true, created_at: iso(30) },
    { id: "st2", sequence_id: "seq1", step_order: 2, name: "Value-add", wait_days: 4, send_condition: "no_reply", subject_template: null, body_template: "Lead with one specific insight about {{business_name}}.", ai_personalize: true, created_at: iso(30) },
    { id: "st3", sequence_id: "seq1", step_order: 3, name: "Break-up", wait_days: 7, send_condition: "always", subject_template: null, body_template: "Close the loop — last touch unless they want to pick it up.", ai_personalize: true, created_at: iso(30) },
  ];
  const sequence_enrollments = [
    { id: "en1", sequence_id: "seq1", outreach_id: "o5", current_step_order: 0, status: "active", enrolled_at: iso(8), next_action_at: iso(5), completed_at: null, last_decision: "Bump due — drafting for approval", updated_at: iso(0.2) },
    { id: "en2", sequence_id: "seq1", outreach_id: "o4", current_step_order: 0, status: "active", enrolled_at: iso(4), next_action_at: iso(-1), completed_at: null, last_decision: "Bump due 2026-07-13", updated_at: iso(0.2) },
    { id: "en3", sequence_id: "seq1", outreach_id: "o1", current_step_order: 1, status: "stopped_reply", enrolled_at: iso(6), next_action_at: null, completed_at: null, last_decision: "prospect replied — sequence stops, human takes over", updated_at: iso(0.3) },
  ];
  const messages = [
    { id: "m1", outreach_id: "o5", enrollment_id: "en1", step_id: null, direction: "outbound", kind: "initial", subject: "West Loop Injury — auction insights", body: "Hi Nick — you dropped out of the top-3 auction slots…", status: "sent", classification: null, gmail_message_id: "gm-5", gmail_thread_id: "th-5", gmail_rfc_message_id: "<rfc-5@mail.gmail.com>", created_at: iso(8), approved_at: iso(8), sent_at: iso(8), meta: {} },
    { id: "m2", outreach_id: "o5", enrollment_id: "en1", step_id: "st1", direction: "outbound", kind: "followup", subject: "Re: West Loop Injury — auction insights", body: "Nick — floating this back up. One stat I didn't include: your top competitor's impression share jumped 11 points…", status: "draft", classification: null, gmail_message_id: null, gmail_thread_id: null, gmail_rfc_message_id: null, created_at: iso(0.1), approved_at: null, sent_at: null, meta: {} },
    { id: "m3", outreach_id: "o1", enrollment_id: "en3", step_id: null, direction: "inbound", kind: "reply", subject: "Re: Your branded campaign", body: "This is interesting — when could we talk this week?", status: "received", classification: "scheduling", classification_confidence: 0.93, classification_source: "ai", classified_at: iso(0.2), gmail_message_id: "gmr-1", gmail_thread_id: "th-1", created_at: iso(0.3), meta: {} },
    { id: "m4", outreach_id: "o1", enrollment_id: null, step_id: null, direction: "outbound", kind: "reply", subject: "Re: Your branded campaign", body: "Hi Dana — Wednesday works. Here's my booking link…", status: "draft", classification: null, gmail_message_id: null, gmail_thread_id: "th-1", created_at: iso(0.2), approved_at: null, sent_at: null, meta: {} },
  ];
  const email_events = [
    { id: 1, message_id: "m1", event_type: "click", url: "https://calendar.example.com/cam", user_agent: "Mozilla/5.0", created_at: iso(6) },
  ];
  const tracked_links = [{ id: "tl1", message_id: "m1", url: "https://calendar.example.com/cam", created_at: iso(8) }];
  const app_settings = [{ key: "scheduling_link", value: { url: "https://calendar.app.google/mock-booking" }, updated_at: iso(10) }];
  const audit_requests = [];
  const rate_events = [];

  return {
    prospects, contacts, outreach, inbound_leads, tone_memory, clients, findings, action_queue,
    sequences, sequence_steps, sequence_enrollments, messages, email_events, tracked_links,
    app_settings, audit_requests, rate_events, prospecting_runs: [],
    metrics_snapshots: [], alerts: [], decks: [], agent_memory: [],
  };
}
