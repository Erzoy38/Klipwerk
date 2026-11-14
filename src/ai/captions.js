// Auto-Untertitel: Ton der Timeline -> Whisper -> Textclips auf einer Untertitel-Spur
import { S, uid, commit, changed, makeTextClip } from '../state.js';
import { audioPlan } from '../render.js';

const SR = 16000;
let worker = null; let seq = 0; const waiting = new Map(); let onDownload = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'download') { onDownload?.(d.value); return; }
    const w = waiting.get(d.id); if (!w) return;
    waiting.delete(d.id);
    if (d.type === 'error') w.reject(new Error(d.message)); else w.resolve(d);
  };
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.reject(new Error(e.message || 'Spracherkennung konnte nicht gestartet werden'));
    waiting.clear(); worker = null;
  };
  return worker;
}
function call(msg, transfer = []) {
  return new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); getWorker().postMessage({ ...msg, id }, transfer); });
}

// Zerlegt den Ton in höchstens 28 s lange Stücke und schneidet dabei an der leisesten Stelle
export function splitAtSilence(audio, maxSec = 28, searchSec = 6) {
  const out = []; let pos = 0; const max = maxSec * SR, win = Math.round(0.1 * SR);
  while (pos < audio.length) {
    let end = Math.min(audio.length, pos + max);
    if (end < audio.length) {
      let best = end, bestE = Infinity;
      for (let s = end - searchSec * SR; s + win <= end; s += win) {
        let e = 0; for (let i = s; i < s + win; i++) e += audio[i] * audio[i];
        if (e < bestE) { bestE = e; best = s + (win >> 1); }
      }
      end = best;
    }
    out.push({ offset: pos / SR, start: pos, end });
    pos = end;
  }
  return out;
}

// Lange Abschnitte in gut lesbare Untertitelzeilen teilen (Zeit anteilig nach Zeichen)
export function toCaptions(segments, maxChars = 42) {
  const caps = [];
  for (const seg of segments) {
    const text = seg.text.trim().replace(/\s+/g, ' ');
    if (!text || seg.end - seg.start < 0.05) continue;
    const words = text.split(' '); const lines = []; let cur = '';
    for (const w of words) {
      if (cur && (cur.length + 1 + w.length) > maxChars) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    const total = lines.reduce((n, l) => n + l.length, 0) || 1; let t = seg.start;
    for (const l of lines) {
      const d = ((seg.end - seg.start) * l.length) / total;
      caps.push({ start: t, end: t + d, text: l }); t += d;
    }
  }
  // Überlappungen bereinigen und sehr kurze Einblendungen verlängern
  caps.sort((a, b) => a.start - b.start);
  for (let i = 0; i < caps.length; i++) {
    const next = caps[i + 1];
    if (caps[i].end - caps[i].start < 0.6) caps[i].end = caps[i].start + 0.6;
    if (next && caps[i].end > next.start) caps[i].end = next.start;
  }
  return caps.filter((c) => c.end - c.start > 0.05);
}

export const CAPTION_STYLE = {
  font: 'Segoe UI', size: 64, color: '#ffffff', bold: true, stroke: '#000000', strokeWidth: 6, shadow: 0.6,
  bgOpacity: 0, caption: true, animIn: { type: 'none', dur: 0.2 }, animOut: { type: 'none', dur: 0.2 },
};

export function insertCaptions(caps) {
  const P = S.project;
  let track = P.tracks.find((t) => t.kind === 'text' && t.name === 'Untertitel');
  if (!track) { track = { id: uid('tr'), kind: 'text', name: 'Untertitel', muted: false, hidden: false }; P.tracks.unshift(track); }
  P.clips = P.clips.filter((c) => !(c.trackId === track.id && c.caption)); // alte Untertitel ersetzen
  const y = Math.round(P.height * 0.36);
  const size = Math.round(Math.min(P.width, P.height) * 0.058);
  for (const c of caps) {
    const clip = makeTextClip(track.id, c.start, { ...CAPTION_STYLE, size, strokeWidth: Math.max(3, Math.round(size * 0.09)), text: c.text, y });
    clip.duration = c.end - c.start;
    P.clips.push(clip);
  }
  commit(); changed();
}

export async function generateCaptions({ model, language, translate, onStatus }) {
  const plan = audioPlan();
  if (!plan.clips.length || plan.duration <= 0) throw new Error('In der Timeline ist kein Ton vorhanden.');
  onStatus('Ton wird vorbereitet …', 0);
  const audio = new Float32Array(await window.api.renderPcm(plan));
  onDownload = (v) => onStatus(`Sprachmodell wird geladen … ${Math.round(v * 100)} %\n(nur beim ersten Mal, danach offline)`, v * 0.3);
  onStatus('Sprachmodell wird geladen …', 0);
  await call({ type: 'load', model });
  const parts = splitAtSilence(audio); const segments = [];
  for (let i = 0; i < parts.length; i++) {
    onStatus(`Sprache wird erkannt … ${Math.round((i / parts.length) * 100)} %`, 0.3 + 0.7 * (i / parts.length));
    const p = parts[i]; const slice = audio.slice(p.start, p.end); const len = slice.length / SR;
    const r = await call({ type: 'run', model, language, task: translate ? 'translate' : 'transcribe', audio: slice }, [slice.buffer]);
    for (const ch of r.chunks) {
      const a = ch.timestamp?.[0] ?? 0; let b = ch.timestamp?.[1]; if (b == null || b <= a) b = len;
      segments.push({ start: p.offset + Math.min(a, len), end: p.offset + Math.min(b, len), text: ch.text || '' });
    }
  }
  const caps = toCaptions(segments);
  if (!caps.length) throw new Error('Es wurde keine Sprache erkannt.');
  insertCaptions(caps);
  onStatus(`Fertig: ${caps.length} Untertitel eingefügt.`, 1);
  return caps.length;
}
