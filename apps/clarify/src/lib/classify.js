// ─── Reply intelligence — AI classification with a heuristic floor ───────────
// Classifies an inbound reply into the product taxonomy and produces a
// SUGGESTED response. The suggestion is a draft, always: it lands in the
// approval queue (messages.status='draft') and never sends itself.
//
// Taxonomy: interested | not_interested | objection | scheduling | question | neutral
// 'scheduling' is the meeting-intent signal — it powers the Book lane.
import { callClaude } from "./claudeApi.js";
import { classifyReply, cleanBody } from "./email.js";
import { T } from "../theme.js";

export const CLASSIFICATIONS = {
  scheduling:     { label: "Wants to meet",   color: T.green,  priority: 5 },
  interested:     { label: "Interested",      color: T.greenHi, priority: 4 },
  objection:      { label: "Objection",       color: T.amber,  priority: 3 },
  question:       { label: "Has questions",   color: T.blue,   priority: 3 },
  neutral:        { label: "Neutral",         color: T.muted,  priority: 2 },
  not_interested: { label: "Not interested",  color: T.red,    priority: 0 },
};

// Heuristic floor — used when the AI call fails and as the pre-check for
// scheduling intent (cheap, instant). Extends the legacy tier classifier.
// Legacy keyword-tier → product taxonomy. Single source of truth — the triage
// banner (OutreachBoard) imports this instead of forking its own copy.
export const TIER_FALLBACK_MAP = { hot: "interested", pass: "not_interested", objection: "objection", later: "neutral", neutral: "neutral" };

export function classifyHeuristic(text) {
  const t = String(text || "").toLowerCase();
  // Scheduling needs a real scheduling cue — a bare weekday name is NOT one
  // ("Monday is our busiest day" in a rejection must not read as intent).
  // Weekdays only count when tied to a time ("tuesday at 2", "free thursday").
  const schedulingCue =
    /\b(calendar|calendly|book(ing)? (a )?(call|time|slot|meeting)|schedule (a )?(call|time|meeting|demo)|availability|available (on|at|this|next)|what times?|when (works|are you)|send (me )?(a )?(time|invite|link)|tomorrow at)\b/.test(t) ||
    /\b(free|open|works?|do|available|good)\b[^.!?]{0,20}\b(mon|tues|wednes|thurs|fri)day\b/.test(t) ||
    /\b(mon|tues|wednes|thurs|fri)day\b[^.!?]{0,15}\b(at|@) ?\d/.test(t);
  if (schedulingCue && !/\b(not interested|no thanks|unsubscribe|remove me|don'?t contact)\b/.test(t)) {
    return { classification: "scheduling", confidence: 0.6 };
  }
  const tier = classifyReply(text).tier;
  return { classification: TIER_FALLBACK_MAP[tier] || "neutral", confidence: 0.4 };
}

// Full AI pass: classification + confidence + a suggested reply draft.
// Returns { classification, confidence, source, suggested: {subject, body} | null }.
export async function classifyReplyAI({ replyBody, replyFrom, originalSubject, originalBody, prospect, toneMemory }) {
  const heuristic = classifyHeuristic(replyBody);
  const tone = (toneMemory || []).length
    ? `\nTone instructions for the suggested reply:\n${toneMemory.map((x) => `- ${x.feedback_text}`).join("\n")}`
    : "";
  const prompt = `You are Cameron from Clarify Paid Search (boutique Google Ads agency, Chicago). Classify this prospect reply and draft a response.

Your original email:
Subject: ${originalSubject || ""}
Body: ${(originalBody || "").slice(0, 600)}

Prospect: ${prospect?.business_name || "unknown"} (${prospect?.category || "local business"})
Their reply (from ${replyFrom || "prospect"}):
"""${String(replyBody || "").slice(0, 1500)}"""

Classify as exactly one of: interested | not_interested | objection | scheduling | question | neutral
- "scheduling" = they want to set a time / asked for availability / said yes to a call.
- "interested" = positive but no scheduling move yet.
- "objection" = pushback (price, already covered, skeptical) that a good answer could turn.
Draft the reply Cameron should send: under 90 words, specific to what they said, plain text. If scheduling: propose locking a time and reference sending a booking link. If not_interested: one gracious line, no pitch.${tone}

Return ONLY valid JSON:
{"classification":"...","confidence":0.0,"reply_subject":"Re: ...","reply_body":"..."}`;

  try {
    const r = await callClaude({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
      fn: "reply_classify",
      promptChars: prompt.length,
    });
    const parsed = JSON.parse((r.text || "{}").replace(/```json|```/g, "").trim());
    if (parsed.classification && CLASSIFICATIONS[parsed.classification]) {
      return {
        classification: parsed.classification,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.75)),
        source: "ai",
        suggested: parsed.reply_body
          ? { subject: parsed.reply_subject || `Re: ${originalSubject || ""}`, body: cleanBody(parsed.reply_body) }
          : null,
      };
    }
  } catch {
    // fall through to heuristic
  }
  return { ...heuristic, source: "heuristic", suggested: null };
}
