import { callClaude } from "./claudeApi.js";
import { T } from "../theme.js";
import { db, normEmail } from "./supabase.js";

// "Under $1,000" / "$1,000–$3,000" → a usable monthly number for client conversion.
export function budgetMidpoint(band) {
  const nums = String(band || "").replace(/,/g, "").match(/\d+/g);
  if (!nums || !nums.length) return null;
  if (nums.length === 1) return Math.round(Number(nums[0]) * (/under|less/i.test(band) ? 0.75 : 1));
  return Math.round((Number(nums[0]) + Number(nums[1])) / 2);
}


// Defensive field access — the inbound form's column names shouldn't break the UI.
export const inboundBiz = (l) => l.business_name || l.company || l.name || "Unknown";

export const inboundPerson = (l) => l.contact_name || l.full_name || (l.name && l.name !== inboundBiz(l) ? l.name : null);

export const inboundService = (l) => l.service || l.service_interest || l.interest || null;

export const inboundBudget = (l) => l.budget || l.budget_range || l.monthly_budget || null;

export const inboundMessage = (l) => l.message || l.details || l.notes || "";


// Create a pipeline card from an inbound lead. If a reply was just sent, the card is
// born already "sent" with the Gmail thread ids wired in — so reply detection and the
// follow-up cadence pick it up exactly like a cold-outreach card. One machine, two doors.
export async function createCardFromInbound(lead, sent = null) {
  const [prospect] = await db.insertProspect({
    business_name: inboundBiz(lead),
    website: lead.website || "",
    category: inboundService(lead) || "inbound",
    ads_detected: false,
  });
  const [contact] = await db.insertContact({
    prospect_id: prospect.id,
    name: inboundPerson(lead),
    email: normEmail(lead.email),
    source: "inbound_form",
  });
  const nowIso = new Date().toISOString();
  const [card] = await db.insertOutreach({
    prospect_id: prospect.id,
    contact_id: contact.id,
    status: sent ? (sent.method === "gmail_compose" ? "draft" : "sent") : "prospected",
    ...(sent ? {
      draft_subject: sent.subject,
      draft_body: sent.body,
      ...(sent.method === "gmail_compose" ? {} : {
        sent_at: nowIso,
        gmail_message_id: sent.messageId || null,
        gmail_thread_id: sent.threadId || null,
        gmail_rfc_message_id: sent.rfcMessageId || null,
        next_follow_up_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      }),
    } : {}),
  });
  return card;
}


// AI reply for an inbound inquiry — grounded in what THEY wrote, not a cold template.
export async function draftInboundReply(lead, card) {
  const prompt = `You are Cameron from Clarify Paid Search, a boutique Google Ads agency in Chicago.

Someone submitted an inquiry through your website:
Business: ${inboundBiz(lead)}
Contact: ${inboundPerson(lead) || "unknown"}
Interested in: ${inboundService(lead) || "paid search help"}
Budget: ${inboundBudget(lead) || "not stated"}
Their message: "${inboundMessage(lead) || "(no message)"}"
${card?.reply_body ? `\nTheir latest email in the thread: "${card.reply_body.slice(0, 400)}"` : ""}

Write a warm, specific reply that:
- Responds to what they actually said or asked
- Moves toward booking a 15-minute intro call
- Stays under 110 words, no fluff, no "leverage"
- Signs off as: Cameron | Clarify Paid Search

Return ONLY valid JSON, no markdown: {"subject": "...", "body": "..."}`;
  const r = await callClaude({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }], fn: "reply_draft", promptChars: prompt.length });
  const text = r.text || "{}";
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch { return { subject: `Re: your Clarify inquiry`, body: text }; }
}


// ─── Duplicate Detection ─────────────────────────────────────────────────────
export function buildDuplicateMap(cards) {
  const byName = {};
  const byEmail = {};

  cards.forEach((card) => {
    const name = card.prospect?.business_name?.toLowerCase().trim();
    const email = card.contact?.email?.toLowerCase().trim();

    if (name) {
      if (!byName[name]) byName[name] = [];
      byName[name].push(card.id);
    }

    if (email && !email.startsWith("hello@")) {
      if (!byEmail[email]) byEmail[email] = [];
      byEmail[email].push(card.id);
    }
  });

  // Only flag actual duplicates (more than 1)
  const dupeNames = new Set(
    Object.entries(byName).filter(([, ids]) => ids.length > 1).flatMap(([, ids]) => ids)
  );
  const dupeEmails = new Set(
    Object.entries(byEmail).filter(([, ids]) => ids.length > 1).flatMap(([, ids]) => ids)
  );

  return { dupeNames, dupeEmails };
}


// ─── Round 5: Prospect intelligence surface ──────────────────────────────────
// Surfaces the "why this prospect, why now" reasoning inline so the operator
// never has to dig. Pure derivation from data already on the card — no API cost.

// One-line reason this prospect is worth a touch, picked by strongest signal.
export function whyNow(card) {
  const p = card.prospect || {};
  const c = card.contact || {};
  const conf = parseFloat(c.email_confidence_score) || 0;
  // Only surface a reason when it's genuinely distinctive. Enrichment is already
  // signalled by the Intel badge, so it's not repeated here as a headline.
  if (p.ads_detected) return { text: "Already running Google Ads — actively spending, high intent", color: T.red, icon: "◉" };
  if (conf >= 90 && c.name) return { text: `Verified contact (${c.name}) at ${conf}% — deliverable & personal`, color: T.green, icon: "✓" };
  if (conf > 0 && conf < 50) return { text: `Low email confidence (${conf}%) — verify before sending`, color: T.amber, icon: "!" };
  return null;
}


// Freshness — prospects decay; a lead sitting untouched for weeks goes cold.
export function freshness(card) {
  if (card.status !== "prospected") return null;
  const created = card.created_at || card.prospect?.created_at;
  if (!created) return null;
  const days = Math.floor((Date.now() - new Date(created).getTime()) / 86400000);
  if (days <= 3) return null; // fresh, no need to flag
  if (days <= 10) return { label: `${days}d in queue`, color: T.faint, warn: false };
  if (days <= 21) return { label: `Aging — ${days}d untouched`, color: T.amber, warn: true };
  return { label: `Going cold — ${days}d untouched`, color: T.red, warn: true };
}


// Detect the angle a draft took, so the operator sees the approach at a glance.
export function draftAngle(body) {
  if (!body) return null;
  const t = body.toLowerCase();
  if (/\b(searches?|search volume|thousands of times|monthly searches|ranking|impression)\b/.test(t)) return { label: "Search-demand", color: T.blue };
  if (/\b(competitor|rival|outranking|others? in your)\b/.test(t)) return { label: "Competitive", color: T.red };
  if (/\b(wasting|overspend|cpa|cost per|budget|inefficien|leak)\b/.test(t)) return { label: "Efficiency", color: T.amber };
  if (/\b(missing|not showing|gap|invisible|absent)\b/.test(t)) return { label: "Coverage-gap", color: T.gold };
  if (/\b(case study|results|grew|increased|drove|client)\b/.test(t)) return { label: "Proof", color: T.green };
  return { label: "Custom", color: T.muted };
}


export function groupCardsByEmail(cards) {
  const emailMap = {};
  cards.forEach(card => {
    const email = card.contact?.email?.toLowerCase().trim();
    if (email && !email.startsWith("hello@")) {
      if (!emailMap[email]) emailMap[email] = [];
      emailMap[email].push(card);
    }
  });
  const seen = new Set();
  const result = [];
  cards.forEach(card => {
    const email = card.contact?.email?.toLowerCase().trim();
    if (email && !email.startsWith("hello@") && emailMap[email]?.length > 1) {
      if (!seen.has(email)) {
        seen.add(email);
        result.push({ type: "chain", primary: emailMap[email][0], rest: emailMap[email].slice(1), email });
      }
    } else {
      result.push({ type: "single", card });
    }
  });
  return result;
}


// ─── Prospect Priority Score ──────────────────────────────────────────────────
// Computed from card data. No API. Determines Hot/Warm/Cold tier on card face.
// ─── Round 1: Value-aware pipeline ───────────────────────────────────────────
// Not every lead is worth the same. Clarify targets high-value service verticals,
// where a single won client's monthly retainer varies widely. This estimates the
// monthly revenue a prospect represents if won, so the pipeline can be worked by
// money rather than raw count. Tunable — these reflect Clarify's $750/mo+ mgmt model.
export const VERTICAL_VALUE = [
  { match: ["personal injury","law firm","attorney","lawyer","legal"], monthly: 2500, label: "Legal" },
  { match: ["plastic surgeon","med spa","cosmetic","dermatolog","aesthetic"], monthly: 2000, label: "Med Spa / Aesthetics" },
  { match: ["mortgage","financial advisor","wealth","insurance"], monthly: 1800, label: "Finance" },
  { match: ["dentist","dental","orthodont","endodont"], monthly: 1500, label: "Dental" },
  { match: ["hvac","plumber","roofing","electrician","home services","contractor","remodel"], monthly: 1500, label: "Home Services" },
  { match: ["physical therapy","chiropract","clinic","medical","health"], monthly: 1000, label: "Healthcare" },
];

export const DEFAULT_VALUE = { monthly: 750, label: "Standard" };


export function estimateValue(card) {
  const cat = (card.prospect?.category || "").toLowerCase();
  const v = VERTICAL_VALUE.find(x => x.match.some(m => cat.includes(m))) || DEFAULT_VALUE;
  // Bump for prospects already advertising — they have budget and intent.
  const adsMultiplier = card.prospect?.ads_detected ? 1.15 : 1;
  return { monthly: Math.round(v.monthly * adsMultiplier), label: v.label, annual: Math.round(v.monthly * adsMultiplier * 12) };
}


// Sum monthly value across a set of cards (the $ in a given pipeline stage).
export function pipelineValue(cards) {
  return cards.reduce((s, c) => s + estimateValue(c).monthly, 0);
}

export const fmtMoney = (n) => n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `$${n}`;

export function getProspectPriority(card) {
  const p = card.prospect || {};
  const c = card.contact || {};
  let score = 0;
  const conf = parseFloat(c.email_confidence_score) || 0;
  if (conf >= 90) score += 3;
  else if (conf >= 70) score += 2;
  else if (conf >= 50) score += 1;
  if (p.ads_detected) score += 4;          // Already spending = strongest buying signal
  if (p.prospect_brief) score += 2;        // Has intel = enriched
  if (c.email_verified) score += 2;        // Verified email = deliverable
  if (c.name) score += 1;                  // Named contact = personalized
  const HIGH_VALUE = ["personal injury attorney","law firm","med spa","plastic surgeon","mortgage broker"];
  if (HIGH_VALUE.some(h => (p.category || "").toLowerCase().includes(h.split(" ")[0]))) score += 1;
  // Ads-live prospects never fall below Warm — they're actively spending, so they
  // always deserve visual priority even if we have little else on them yet.
  if (score >= 7) return { tier: "Hot", color: T.red, bg: "rgba(248,113,113,0.09)", border: "rgba(248,113,113,0.28)", ads: !!p.ads_detected };
  if (score >= 4 || p.ads_detected) return { tier: "Warm", color: T.amber, bg: "rgba(245,184,77,0.08)", border: "rgba(245,184,77,0.25)", ads: !!p.ads_detected };
  return { tier: "Cold", color: T.faint, bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.07)", ads: false };
}
