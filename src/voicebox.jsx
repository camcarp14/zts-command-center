// ─── Voicebox integration — the voice half of the Studio ─────────────────────
// Voicebox (github.com/jamiepine/voicebox) is a local-first AI voice studio:
// clone a voice from reference audio, then generate speech on your own GPU —
// nothing leaves the machine. This module is everything the Command Center
// needs to talk to it: a client for its local REST API, a voice rail for the
// Studio view, and a per-Short voiceover block for the asset panel.
//
// Same contract as the Factory bridge: local-only (127.0.0.1:17493). When the
// Voicebox app is running, a scripted Short becomes a finished voiceover
// without leaving Studio. When it's not — including on the deployed site —
// everything degrades to a quiet explainer instead of failing.
//
// Voiceover metadata deliberately lives in localStorage (zts_vo_*), NOT
// Supabase: the audio itself only exists in Voicebox's database on the machine
// that generated it, so syncing pointers to other devices would only produce
// dead references. Same reasoning as factory/projects/ staying gitignored.
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, M, useToast } from "./ui.jsx";

const VOICEBOX = "http://127.0.0.1:17493";

// Palette mirror (App.jsx owns the canonical inline T).
const V = {
  ink: "#0B1220", sub: "#64748B", faint: "#8A97A8",
  green: "#0E9F6E", greenDeep: "#0A7A54", amber: "#F59E0B", amberDeep: "#B68A2E",
  red: "#DC2626", purple: "#7C3AED",
  card: "#FFFFFF", subtle: "#F8FAFC", line: "rgba(15,23,42,0.06)",
  navyGrad: "linear-gradient(135deg, #16233B 0%, #0B1120 100%)",
  syne: "'Syne', system-ui", mono: "'DM Mono', monospace",
};

async function vbFetch(path, opts = {}, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${VOICEBOX}${path}`, { ...opts, signal: ctrl.signal });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json())?.detail || detail; } catch {}
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export const audioUrl = (generationId) => `${VOICEBOX}/audio/${encodeURIComponent(generationId)}`;

// Languages Voicebox's /generate accepts; anything else falls back to English.
const VB_LANGUAGES = new Set(["zh","en","ja","ko","de","fr","ru","pt","es","it","he","ar","da","el","fi","hi","ms","nl","no","pl","sv","sw","tr"]);
const ENGINE_LABELS = {
  qwen: "Qwen3-TTS", qwen_custom_voice: "Qwen CustomVoice", luxtts: "LuxTTS",
  chatterbox: "Chatterbox", chatterbox_turbo: "Chatterbox Turbo", tada: "TADA", kokoro: "Kokoro",
};
export const engineLabel = (e) => ENGINE_LABELS[e] || e || "Voicebox";

// ─── voStore — machine-local voiceover metadata, one record per Short ────────
export const voStore = {
  get: (shortId) => { try { return JSON.parse(localStorage.getItem(`zts_vo_${shortId}`)); } catch { return null; } },
  set: (shortId, vo) => { try { localStorage.setItem(`zts_vo_${shortId}`, JSON.stringify(vo)); } catch {} },
  del: (shortId) => { try { localStorage.removeItem(`zts_vo_${shortId}`); } catch {} },
};

// Same 31-bit string hash as App.jsx's stateHash — enough to notice the script
// changed after the voiceover was generated (staleness, not integrity).
export function hashScript(text) {
  const s = (text || "").trim();
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return String(h);
}

// Once Voicebox has ever been seen online on this machine, the agent engine may
// mention voiceover gaps. Users who never run it never hear about it.
export const voiceboxEverSeen = () => { try { return localStorage.getItem("zts_vb_seen") === "1"; } catch { return false; } };
const markVoiceboxSeen = () => { try { localStorage.setItem("zts_vb_seen", "1"); } catch {} };

// ─── useVoicebox — app status + voice profiles, polled gently ────────────────
export function useVoicebox(active) {
  const [status, setStatus] = useState("checking"); // checking | online | offline
  const [health, setHealth] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const refresh = useCallback(async () => {
    try {
      const h = await vbFetch("/health");
      const list = await vbFetch("/profiles");
      if (!mountedRef.current) return;
      setHealth(h || null);
      setProfiles(Array.isArray(list) ? list : []);
      setStatus("online");
      markVoiceboxSeen();
    } catch {
      if (!mountedRef.current) return;
      setStatus("offline");
      setHealth(null);
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    timerRef.current = setInterval(refresh, 15000);
    return () => clearInterval(timerRef.current);
  }, [active, refresh]);

  return { status, health, profiles, refresh };
}

// ─── Generation lifecycle ────────────────────────────────────────────────────
// POST /generate queues the work and returns immediately with status
// "generating"; the audio lands when GET /history/{id} reports "completed".
async function startGeneration({ profile, text }) {
  const lang = VB_LANGUAGES.has(profile.language) ? profile.language : "en";
  // Engine resolved client-side, same as Voicebox's own frontend: the API's
  // engine field defaults to "qwen" when omitted, which would silently ignore
  // the profile's own default and reject preset voices outright. Explicit
  // null lets the server walk its default_engine → preset_engine → qwen chain.
  const engine = profile.default_engine || profile.preset_engine || null;
  return vbFetch("/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: profile.id, text, language: lang, engine }),
  }, 15000);
}

const pollGeneration = (generationId) => vbFetch(`/history/${encodeURIComponent(generationId)}`);

const fmtDur = (s) => (s == null ? null : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`);

// ─── VoiceoverBlock — the voiceover asset inside a Short's detail modal ──────
// Owns the full lifecycle: pick a cloned voice → generate → live progress →
// inline player + download. Resumes polling if the modal was closed mid-
// generation, and flags the take as stale when the script changes afterward.
export function VoiceoverBlock({ short, onLog }) {
  const { status, profiles } = useVoicebox(true);
  const [vo, setVo] = useState(() => voStore.get(short.id));
  const [profileId, setProfileId] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [starting, setStarting] = useState(false);
  const toast = useToast();
  const pollRef = useRef(null);
  const startedRef = useRef(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const saveVo = useCallback((next) => {
    // The store write always lands (the generation is real regardless of this
    // component's fate); state only updates while mounted.
    if (next) voStore.set(short.id, next); else voStore.del(short.id);
    if (mountedRef.current) setVo(next);
  }, [short.id]);

  // Poll a generating take until it settles. Also the resume path: a modal
  // reopened mid-generation picks the loop back up from the stored record —
  // elapsed time counted from the take's real start, not from the reopen.
  useEffect(() => {
    if (vo?.status !== "generating" || status !== "online") return;
    if (!startedRef.current) startedRef.current = (vo.created_at && Date.parse(vo.created_at)) || Date.now();
    let cancelled = false;
    const showElapsed = () => setElapsed(Math.max(0, Math.round((Date.now() - startedRef.current) / 1000)));
    showElapsed();
    const secTimer = setInterval(showElapsed, 1000);
    const tick = async () => {
      if (cancelled) return;
      try {
        const gen = await pollGeneration(vo.generation_id);
        if (cancelled) return;
        if (gen.status === "completed") {
          const done = { ...vo, status: "completed", duration: gen.duration ?? null, engine: gen.engine || vo.engine, profile_name: gen.profile_name || vo.profile_name };
          saveVo(done);
          onLog?.({ fn: "voiceover", model: `voicebox:${done.engine || "tts"}`, inputTokens: 0, outputTokens: 0, costEstimate: 0, latencyMs: Date.now() - startedRef.current, ok: true });
          toast.push(`Voiceover ready — ${done.profile_name}${done.duration ? `, ${fmtDur(done.duration)}` : ""}. Free, local, yours.`, { tone: "success" });
          return;
        }
        if (gen.status === "failed") {
          saveVo({ ...vo, status: "failed", error: gen.error || "Generation failed in Voicebox." });
          onLog?.({ fn: "voiceover", model: `voicebox:${vo.engine || "tts"}`, costEstimate: 0, latencyMs: Date.now() - startedRef.current, ok: false });
          toast.push(gen.error || "Voiceover generation failed — check the Voicebox app.", { tone: "error" });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        if (e?.status === 404) {
          saveVo({ ...vo, status: "failed", error: "This take is no longer in Voicebox's history." });
          return;
        }
        // Transient network blip or Voicebox restarting — keep polling.
      }
      pollRef.current = setTimeout(tick, 2000);
    };
    tick();
    return () => { cancelled = true; clearTimeout(pollRef.current); clearInterval(secTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vo?.status, vo?.generation_id, status]);

  const generate = async (pid) => {
    if (startingRef.current || !short.script) return; // one POST per click-burst
    const profile = profiles.find(p => p.id === pid);
    if (!profile) {
      toast.push("That voice isn't in Voicebox anymore — remove this take or pick another voice.", { tone: "warning" });
      return;
    }
    startingRef.current = true;
    setStarting(true);
    startedRef.current = Date.now();
    setElapsed(0);
    try {
      const gen = await startGeneration({ profile, text: short.script });
      saveVo({
        generation_id: gen.id, profile_id: profile.id, profile_name: profile.name,
        engine: gen.engine || profile.default_engine || profile.preset_engine || null,
        status: "generating", duration: null, error: null,
        script_hash: hashScript(short.script), created_at: new Date().toISOString(),
      });
    } catch (e) {
      toast.push(`Couldn't start the voiceover — ${e?.message || "is Voicebox still running?"}`, { tone: "error" });
    }
    startingRef.current = false;
    if (mountedRef.current) setStarting(false);
  };

  const stale = vo?.status === "completed" && vo.script_hash !== hashScript(short.script);
  const chip = (color, label) => (
    <span style={{ fontSize: "9px", fontWeight: 700, color, background: color + "15", padding: "1px 7px", borderRadius: "5px", fontFamily: V.syne, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
  );
  const smallBtn = (onClick, label, tone = V.greenDeep) => (
    <button onClick={onClick} style={{ background: "none", border: "none", color: tone, fontSize: "10px", fontWeight: 700, cursor: "pointer", fontFamily: V.syne, padding: 0 }}>{label}</button>
  );
  const shell = { background: V.subtle, border: `1px solid ${V.line}`, borderRadius: "10px", padding: "12px 14px" };

  // ── No take yet ──
  if (!vo || (vo.status === "failed" && !vo.generation_id)) {
    return (
      <div style={shell}>
        {status === "offline" && (
          <div style={{ fontSize: "11.5px", color: V.sub, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: V.ink }}>Voicebox is offline.</span> Launch the Voicebox app on this machine and a cloned-voice voiceover of this script is one click — free, local, no ElevenLabs bill.
          </div>
        )}
        {status === "checking" && <div style={{ fontSize: "11.5px", color: V.faint }}>Looking for Voicebox…</div>}
        {status === "online" && profiles.length === 0 && (
          <div style={{ fontSize: "11.5px", color: V.sub, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: V.ink }}>Voicebox is connected</span> but has no voice profiles yet. Clone a voice in the Voicebox app (a minute of clean reference audio), then generate the VO here.
          </div>
        )}
        {status === "online" && profiles.length > 0 && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}
              style={{ flex: 1, minWidth: "160px", padding: "8px 10px", border: `1px solid ${V.line}`, borderRadius: "8px", fontSize: "12px", color: V.ink, background: V.card }}>
              <option value="">Pick a voice…</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.generation_count ? ` · ${p.generation_count} takes` : ""}</option>)}
            </select>
            <button onClick={() => profileId && generate(profileId)} disabled={!profileId || starting}
              style={{ padding: "8px 16px", background: profileId && !starting ? V.navyGrad : "rgba(15,23,42,0.06)", border: "none", borderRadius: "8px", color: profileId && !starting ? "#FFF" : V.faint, fontSize: "11px", fontWeight: 700, cursor: profileId && !starting ? "pointer" : "default", fontFamily: V.syne }}>
              {starting ? "Starting…" : "🎙 Generate voiceover"}
            </button>
          </div>
        )}
        {vo?.error && <div style={{ fontSize: "10.5px", color: V.red, marginTop: "8px" }}>{vo.error}</div>}
      </div>
    );
  }

  // ── Generating ──
  if (vo.status === "generating") {
    return (
      <div style={shell}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: V.amber, animation: "pulse 1.4s infinite", flexShrink: 0 }} />
          <span style={{ fontSize: "12px", fontWeight: 600, color: V.ink }}>Generating with {vo.profile_name}…</span>
          <span style={{ fontSize: "10px", color: V.faint, fontFamily: V.mono, marginLeft: "auto" }}>{elapsed}s</span>
        </div>
        <div style={{ fontSize: "10.5px", color: V.faint, marginTop: "6px", lineHeight: 1.5 }}>
          Running locally on your hardware — a first run may take longer while the model loads. Safe to close this; it keeps going in Voicebox.
        </div>
        {status === "offline" && <div style={{ fontSize: "10.5px", color: V.amberDeep, marginTop: "6px" }}>Voicebox went offline mid-generation — it resumes reporting when the app is back.</div>}
      </div>
    );
  }

  // ── Failed ──
  if (vo.status === "failed") {
    return (
      <div style={{ ...shell, borderColor: "rgba(220,38,38,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {chip(V.red, "failed")}
          <span style={{ fontSize: "11.5px", color: V.sub, flex: 1, minWidth: "160px" }}>{vo.error || "Generation failed in Voicebox."}</span>
          {status === "online" && profiles.length > 0 && smallBtn(() => generate(vo.profile_id || profiles[0].id), starting ? "starting…" : "↻ retry")}
          {smallBtn(() => saveVo(null), "✕ clear", V.faint)}
        </div>
      </div>
    );
  }

  // ── Completed ──
  return (
    <div style={shell}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "9px" }}>
        {chip(V.green, "voiced")}
        {stale && chip(V.amber, "script changed")}
        <span style={{ fontSize: "11px", color: V.sub }}>
          <span style={{ fontWeight: 700, color: V.ink }}>{vo.profile_name}</span>
          {vo.engine ? ` · ${engineLabel(vo.engine)}` : ""}{vo.duration ? ` · ${fmtDur(vo.duration)}` : ""}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
          {status === "online" && smallBtn(() => generate(vo.profile_id), starting ? "starting…" : "↻ regenerate")}
          {smallBtn(() => saveVo(null), "✕ remove", V.faint)}
        </span>
      </div>
      {stale && (
        <div style={{ fontSize: "10.5px", color: V.amberDeep, marginBottom: "8px", lineHeight: 1.5 }}>
          The script was edited after this take was recorded — regenerate so the audio matches.
        </div>
      )}
      {status === "online" ? (
        <>
          <audio controls preload="none" src={audioUrl(vo.generation_id)} style={{ width: "100%", height: "36px", display: "block" }} />
          <div style={{ marginTop: "7px", textAlign: "right" }}>
            <a href={audioUrl(vo.generation_id)} style={{ fontSize: "10px", fontWeight: 700, color: V.greenDeep, fontFamily: V.syne, textDecoration: "none" }}>⇩ Download audio</a>
          </div>
        </>
      ) : (
        <div style={{ fontSize: "10.5px", color: V.faint, lineHeight: 1.5 }}>
          The audio lives in Voicebox on the machine that generated it — launch the app there to play or download this take.
        </div>
      )}
    </div>
  );
}

// ─── VoiceboxPanel — the voice rail inside Studio, beside the Factory rail ───
export function VoiceboxPanel({ shorts = [], isMobile }) {
  const { status, health, profiles } = useVoicebox(true);
  const scripted = shorts.filter(s => s.script);
  const voiced = scripted.filter(s => voStore.get(s.id)?.status === "completed");

  const statusLine = status === "online"
    ? `connected · ${profiles.length} voice${profiles.length !== 1 ? "s" : ""}${health?.gpu_type ? ` · ${health.gpu_type}` : health?.backend_type ? ` · ${health.backend_type}` : ""}${scripted.length ? ` · ${voiced.length}/${scripted.length} scripted Shorts voiced` : ""}`
    : status === "checking" ? "looking for the app…" : "app offline";

  return (
    <div style={{ marginTop: "26px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "12px" }}>
        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: status === "online" ? V.green : status === "checking" ? V.amber : "#CBD5E1", animation: status === "online" ? "pulse 2.5s infinite" : "none" }} />
        <span style={{ fontSize: "11px", fontWeight: 700, color: V.sub, textTransform: "uppercase", letterSpacing: "0.13em", fontFamily: V.syne }}>Voicebox — voice lab</span>
        <span style={{ fontSize: "10px", color: V.faint, fontFamily: V.mono }}>{statusLine}</span>
      </div>

      {status === "offline" && (
        <div style={{ background: V.card, border: `1px dashed rgba(15,23,42,0.12)`, borderRadius: "14px", padding: "16px 18px", display: "flex", gap: "14px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "240px" }}>
            <div style={{ fontSize: "12.5px", fontWeight: 700, color: V.ink, fontFamily: V.syne, marginBottom: "4px" }}>Cloned-voice voiceovers, on your machine</div>
            <div style={{ fontSize: "11.5px", color: V.sub, lineHeight: 1.6 }}>
              Voicebox is a free, open-source voice studio — clone your voice once from a minute of reference audio, and every scripted Short here grows a one-click <span style={{ fontFamily: V.mono, background: V.subtle, padding: "1px 5px", borderRadius: "4px" }}>Voiceover</span> asset: generated locally, played in-app, downloaded as a file for the edit. No cloud, no per-character bill.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "200px", alignItems: "flex-end" }}>
            <a href="https://github.com/jamiepine/voicebox" target="_blank" rel="noopener"
              style={{ fontFamily: V.mono, fontSize: "11px", background: "#0B1120", color: "#7DE3B8", padding: "8px 12px", borderRadius: "8px", textDecoration: "none", whiteSpace: "nowrap" }}>
              github.com/jamiepine/voicebox ↗
            </a>
            <span style={{ fontSize: "10px", color: V.faint }}>install it, launch it — this rail comes alive</span>
          </div>
        </div>
      )}

      {status === "online" && profiles.length === 0 && (
        <EmptyState compact icon="spark" tint={V.purple} title="Voicebox connected — no voices yet"
          sub="Clone a voice in the Voicebox app from a minute of clean reference audio. It shows up here, ready to read every script." />
      )}

      {status === "online" && profiles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(200px, 1fr))", gap: "10px" }}>
          {profiles.map((p, idx) => (
            <div key={p.id} style={{
              background: V.card, border: `1px solid ${V.line}`, borderLeft: `3px solid ${V.purple}`,
              borderRadius: "12px", padding: "12px 14px",
              animation: `cardIn 0.3s ${M.easeOut} both`, animationDelay: `${Math.min(idx, 8) * 30}ms`,
            }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: V.ink, fontFamily: V.syne }}>{p.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "5px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "9px", fontWeight: 700, color: V.purple, background: V.purple + "15", padding: "1px 7px", borderRadius: "5px", fontFamily: V.syne, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {p.voice_type === "cloned" ? "cloned" : p.voice_type || "voice"}
                </span>
                <span style={{ fontSize: "10px", color: V.faint, fontFamily: V.mono }}>
                  {(p.language || "en").toUpperCase()}{p.default_engine || p.preset_engine ? ` · ${engineLabel(p.default_engine || p.preset_engine)}` : ""}
                </span>
              </div>
              {p.generation_count > 0 && <div style={{ fontSize: "10px", color: V.faint, marginTop: "6px", fontFamily: V.mono }}>{p.generation_count} take{p.generation_count !== 1 ? "s" : ""} generated</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
