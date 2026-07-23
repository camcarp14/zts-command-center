// ─── Data access for sequencing tables (migration 0002) ─────────────────────
// All calls ride sbFetch, which sends the signed-in session token — these
// tables are authenticated-only under RLS. Kept separate from lib/supabase.js
// so the legacy db object stays untouched.
import { sbFetch } from "./supabase.js";

export const seqDb = {
  // ── sequences & steps ──
  async getSequences() {
    return sbFetch(`/sequences?order=created_at.asc`);
  },
  async getSteps(sequenceId = null) {
    const filter = sequenceId ? `sequence_id=eq.${sequenceId}&` : "";
    return sbFetch(`/sequence_steps?${filter}order=step_order.asc`);
  },
  async createSequence(fields) {
    const rows = await sbFetch(`/sequences`, { method: "POST", body: JSON.stringify(fields) });
    return rows && rows[0];
  },
  async updateSequence(id, fields) {
    return sbFetch(`/sequences?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(fields) });
  },
  async deleteSequence(id) {
    return sbFetch(`/sequences?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
  },
  async createStep(fields) {
    const rows = await sbFetch(`/sequence_steps`, { method: "POST", body: JSON.stringify(fields) });
    return rows && rows[0];
  },
  async updateStep(id, fields) {
    return sbFetch(`/sequence_steps?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(fields) });
  },
  async deleteStep(id) {
    return sbFetch(`/sequence_steps?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
  },

  // ── enrollments ──
  async getEnrollments(statusIn = ["active", "paused"]) {
    return sbFetch(`/sequence_enrollments?status=in.(${statusIn.join(",")})&order=enrolled_at.asc`);
  },
  async getAllEnrollments() {
    return sbFetch(`/sequence_enrollments?order=enrolled_at.desc&limit=500`);
  },
  async enroll(outreachId, sequenceId) {
    const rows = await sbFetch(`/sequence_enrollments`, {
      method: "POST",
      body: JSON.stringify({ outreach_id: outreachId, sequence_id: sequenceId }),
    });
    return rows && rows[0];
  },
  async updateEnrollment(id, fields) {
    return sbFetch(`/sequence_enrollments?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(fields) });
  },

  // ── messages (the ledger; the approval queue is direction=outbound status=draft) ──
  async getQueue() {
    return sbFetch(`/messages?direction=eq.outbound&status=eq.draft&order=created_at.asc&select=*,outreach:outreach(*,prospect:prospects(*),contact:contacts(*))`);
  },
  async getQueueCount() {
    const rows = await sbFetch(`/messages?direction=eq.outbound&status=eq.draft&select=id`);
    return (rows || []).length;
  },
  async getMessagesFor(outreachIds) {
    if (!outreachIds || outreachIds.length === 0) return [];
    // Chunk the in.() list — 36-char uuids blow past safe URL length around
    // ~50 ids, and an agency pipeline gets there fast.
    const CHUNK = 40;
    const chunks = [];
    for (let i = 0; i < outreachIds.length; i += CHUNK) chunks.push(outreachIds.slice(i, i + CHUNK));
    const results = await Promise.all(
      chunks.map((ids) => sbFetch(`/messages?outreach_id=in.(${ids.join(",")})&order=created_at.asc`))
    );
    return results.flat().filter(Boolean);
  },
  async insertMessage(fields) {
    const rows = await sbFetch(`/messages`, { method: "POST", body: JSON.stringify(fields) });
    return rows && rows[0];
  },
  async updateMessage(id, fields) {
    return sbFetch(`/messages?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(fields) });
  },

  // ── events & links ──
  // Takes ALREADY-FETCHED messages so callers never pay a duplicate messages
  // round-trip just to derive event ids (the engine fetches both per pass).
  async getEventsForMessages(messages) {
    const ids = (messages || []).map((m) => m.id).filter(Boolean);
    if (ids.length === 0) return [];
    const CHUNK = 40;
    const chunks = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    const results = await Promise.all(
      chunks.map((c) => sbFetch(`/email_events?message_id=in.(${c.join(",")})&order=created_at.asc`))
    );
    return results.flat().filter(Boolean);
  },
  async getAllEvents(limit = 2000) {
    return sbFetch(`/email_events?order=created_at.desc&limit=${limit}`);
  },
  async createTrackedLink(messageId, url) {
    const rows = await sbFetch(`/tracked_links`, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId, url }),
    });
    return rows && rows[0];
  },

  // ── settings ──
  async getSetting(key) {
    const rows = await sbFetch(`/app_settings?key=eq.${encodeURIComponent(key)}&limit=1`);
    return rows && rows[0] ? rows[0].value : null;
  },
  async setSetting(key, value) {
    return sbFetch(`/app_settings?on_conflict=key`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
  },
};
