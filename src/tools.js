// Zusatzwerkzeuge: Standbild, Ton abtrennen, Rückwärts, Pausen entfernen, Person zentrieren, Aufnahme, SRT, Einzelbild
import {
  S, uid, getMedia, getClip, selectedClip, clipEnd, freeStart, commit, changed, emit, toast, audioDefaults, makeMediaClip,
  evalProp, localTime, KF_PROPS, mediaUrl, clamp,
} from './state.js';
import { grabFrame, renderEnv, pause, play } from './player.js';
import { drawFrame } from './render.js';
import { addMedia } from './timeline.js';
import { importPaths, renderMedia } from './panels.js';
import { segmenter } from './ai/segmenter.js';
import { insertCaptions } from './ai/captions.js';

const api = window.api;
const clone = (o) => JSON.parse(JSON.stringify(o));
const blobOf = (canvas, type = 'image/png', q) => new Promise((r) => canvas.toBlob(r, type, q));
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function needClip(types, msg) {
  const c = selectedClip();
  if (!c || !types.includes(c.type)) { toast(msg); return null; }
  return c;
}
// Keyframes eines Clips auf feste Werte an einer Stelle reduzieren
function flatten(c, local) { if (!c.kf) return; for (const n of KF_PROPS) c[n] = evalProp(c, n, local); c.kf = {}; }
function shiftAfter(trackId, from, delta, skipIds = []) {
  for (const x of S.project.clips) if (x.trackId === trackId && x.start >= from - 1e-6 && !skipIds.includes(x.id)) x.start = Math.max(0, x.start + delta);
}

// ---------- Standbild ----------
export async function freezeFrame(seconds = 2) {
  const c = needClip(['video'], 'Wähle zuerst einen Videoclip aus.'); if (!c) return;
  const t = S.time;
  if (t <= c.start + 0.04 || t >= clipEnd(c) - 0.04) { toast('Setze den Abspielkopf auf die Stelle im Clip, die eingefroren werden soll.'); return; }
  const cv = grabFrame(c); if (!cv) { toast('Das Bild ist noch nicht geladen – bitte kurz warten.'); return; }
  try {
    const path = await api.saveImage(await (await blobOf(cv)).arrayBuffer());
    const m = await importPaths([path]); if (!m) return;
    m.name = 'Standbild'; renderMedia();
    const b = clone(c); b.id = uid('c'); const end = clipEnd(c), local = t - c.start;
    const still = makeMediaClip(m, c.trackId, t); still.duration = seconds;
    for (const k of ['flip', 'filter', 'fx', 'blend', 'crop', 'mask', 'chroma', 'bg']) if (c[k] !== undefined) still[k] = clone(c[k]);
    for (const n of KF_PROPS) still[n] = evalProp(c, n, local);
    shiftAfter(c.trackId, end, seconds);
    c.duration = local; c.animOut = { ...c.animOut, type: 'none' }; c.fadeOut = 0;
    b.start = t + seconds; b.duration = end - t; b.offset = c.offset + local * c.speed; b.animIn = { ...b.animIn, type: 'none' }; b.fadeIn = 0;
    for (const n of KF_PROPS) for (const k of (b.kf?.[n] || [])) k.t -= local;
    S.project.clips.push(still, b); S.selection = still.id;
    commit(); changed(); emit('selection'); toast('Standbild eingefügt.', 'ok');
  } catch (e) { toast(`Standbild fehlgeschlagen: ${errText(e)}`, 'error'); }
}

// ---------- Ton abtrennen ----------
export function detachAudio() {
  const c = needClip(['video'], 'Wähle zuerst einen Videoclip aus.'); if (!c) return;
  if (!getMedia(c.mediaId)?.hasAudio) { toast('Dieser Clip hat keine Tonspur.'); return; }
  if (c.muted) { toast('Der Ton dieses Clips wurde bereits abgetrennt oder stummgeschaltet.'); return; }
  const P = S.project;
  let track = P.tracks.find((t) => t.kind === 'audio' && Math.abs(freeStart(t.id, c.start, c.duration) - c.start) < 1e-6);
  if (!track) { track = { id: uid('tr'), kind: 'audio', name: `Audio ${P.tracks.filter((t) => t.kind === 'audio').length + 1}`, muted: false, hidden: false }; P.tracks.push(track); }
  const a = { id: uid('c'), trackId: track.id, mediaId: c.mediaId, type: 'audio', start: c.start, duration: c.duration, offset: c.offset, speed: c.speed,
    ...audioDefaults(), volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, afx: c.afx, afxPath: c.afxPath };
  c.muted = true; c.afx = 'none'; c.afxPath = null;
  P.clips.push(a); commit(); changed(); toast('Ton als eigener Clip abgetrennt.', 'ok');
}

// ---------- Rückwärts ----------
export async function reverseClip() {
  const c = needClip(['video'], 'Wähle zuerst einen Videoclip aus.'); if (!c) return;
  const m = getMedia(c.mediaId); const srcDur = c.duration * c.speed;
  if (srcDur > 60) { toast('Rückwärts geht für Clips bis 60 Sekunden – teile den Clip vorher.'); return; }
  toast('Clip wird rückwärts umgerechnet …', 'info', 5000);
  try {
    const path = await api.reverse(m.path, c.offset, srcDur, !!m.hasAudio);
    const nm = await importPaths([path]); if (!nm || !getClip(c.id)) return;
    nm.name = `${m.name} (rückwärts)`; renderMedia();
    c.mediaId = nm.id; c.offset = 0; c.duration = Math.min(c.duration, nm.duration / c.speed); c.afx = 'none'; c.afxPath = null;
    commit(); changed(); toast('Clip läuft jetzt rückwärts.', 'ok');
  } catch (e) { toast(errText(e), 'error', 7000); }
}

// ---------- Pausen entfernen ----------
export async function removeSilence(noiseDb = -35, minDur = 0.45) {
  const c = needClip(['video', 'audio'], 'Wähle zuerst einen Clip mit Ton aus.'); if (!c) return 0;
  const m = getMedia(c.mediaId); if (!m?.hasAudio) { toast('Dieser Clip hat keine Tonspur.'); return 0; }
  let list;
  try { list = await api.silences(m.path, noiseDb, minDur); } catch (e) { toast(errText(e), 'error'); return 0; }
  if (!getClip(c.id)) return 0;
  const a = c.offset, b = c.offset + c.duration * c.speed, pad = 0.1; const keep = []; let cur = a;
  for (const [s0, e0] of list) {
    const s = Math.max(a, s0 + pad), e = Math.min(b, e0 - pad);
    if (e - s < 0.2 || e <= a || s >= b) continue;
    if (s - cur > 0.12) keep.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (b - cur > 0.12) keep.push([cur, b]);
  const kept = keep.reduce((n, k) => n + (k[1] - k[0]), 0) / c.speed, removed = c.duration - kept;
  if (!keep.length || removed < 0.15) { toast('Keine Pausen gefunden.'); return 0; }
  const end = clipEnd(c); let t = c.start; const made = [];
  keep.forEach((k, i) => {
    const n = clone(c); n.id = uid('c'); flatten(n, clamp((k[0] - a) / c.speed, 0, c.duration));
    n.offset = k[0]; n.duration = (k[1] - k[0]) / c.speed; n.start = t; t += n.duration;
    if (i > 0) { n.animIn = n.animIn && { ...n.animIn, type: 'none' }; n.fadeIn = 0; }
    if (i < keep.length - 1) { n.animOut = n.animOut && { ...n.animOut, type: 'none' }; n.fadeOut = 0; }
    made.push(n);
  });
  S.project.clips = S.project.clips.filter((x) => x.id !== c.id);
  shiftAfter(c.trackId, end, -removed);
  S.project.clips.push(...made); S.selection = made[0].id;
  commit(); changed(); emit('selection');
  toast(`${keep.length - 1 || 1} Pause(n) entfernt – ${removed.toFixed(1)} s kürzer.`, 'ok');
  return keep.length;
}

// ---------- KI: Person im Bild halten (Auto-Reframe) ----------
export async function autoReframe(onStatus = () => {}) {
  const c = needClip(['video'], 'Wähle zuerst einen Videoclip aus.'); if (!c) return false;
  const m = getMedia(c.mediaId), P = S.project;
  onStatus('KI-Modell wird geladen …', 0);
  await segmenter.load();
  if (segmenter.state !== 'ready') throw new Error(`Modell konnte nicht geladen werden: ${segmenter.error || ''}`);
  const el = document.createElement('video'); el.muted = true; el.preload = 'auto'; el.src = mediaUrl(m.path);
  await new Promise((res, rej) => { el.addEventListener('loadeddata', res, { once: true }); el.addEventListener('error', () => rej(new Error('Video nicht lesbar')), { once: true }); });
  const step = 0.5, n = Math.max(2, Math.ceil(c.duration / step) + 1); const xs = []; let found = 0;
  for (let i = 0; i < n; i++) {
    const local = Math.min(c.duration, i * step);
    const target = Math.min(Math.max(0, m.duration - 0.05), c.offset + local * c.speed);
    await new Promise((res) => { const to = setTimeout(res, 4000); el.addEventListener('seeked', () => { clearTimeout(to); res(); }, { once: true }); el.currentTime = target; });
    const p = segmenter.locate(el, el.videoWidth, el.videoHeight);
    if (p) found++;
    xs.push({ t: local, x: p ? p.x : null });
    onStatus(`Bild wird analysiert … ${Math.round(((i + 1) / n) * 100)} %`, (i + 1) / n);
  }
  try { el.removeAttribute('src'); el.load(); } catch {}
  if (!found || !getClip(c.id)) { if (!found) throw new Error('Es wurde keine Person erkannt.'); return false; }
  let last = xs.find((v) => v.x != null).x;
  for (const v of xs) { if (v.x == null) v.x = last; else last = v.x; }
  const fit = Math.min(P.width / m.width, P.height / m.height), cover = Math.max(P.width / m.width, P.height / m.height);
  const scale = cover / fit, w = m.width * fit * scale, lim = Math.max(0, (w - P.width) / 2);
  const sm = xs.map((v, i) => { let s = 0, k = 0; for (let j = Math.max(0, i - 2); j <= Math.min(xs.length - 1, i + 2); j++) { s += xs[j].x; k++; } return s / k; });
  c.kf ||= {}; delete c.kf.scale; delete c.kf.y;
  c.scale = scale; c.y = 0;
  c.kf.x = xs.map((v, i) => ({ t: v.t, v: Math.round(clamp((0.5 - sm[i]) * w, -lim, lim)) }));
  commit(); changed(); emit('selection');
  onStatus('Fertig – die Person bleibt in der Bildmitte.', 1);
  return true;
}

// ---------- Einzelbild speichern ----------
export async function saveSnapshot() {
  const P = S.project; const cv = document.createElement('canvas'); cv.width = P.width; cv.height = P.height;
  drawFrame(cv, S.time, renderEnv);
  const path = await api.saveFileDialog({ title: 'Einzelbild speichern', name: `${P.name} Bild.png`, folder: 'pictures', filters: [{ name: 'PNG-Bild', extensions: ['png'] }] });
  if (!path) return;
  try { await api.writeFile(path, await (await blobOf(cv)).arrayBuffer()); toast('Einzelbild gespeichert.', 'ok'); }
  catch (e) { toast(errText(e), 'error'); }
}

// ---------- Sprachaufnahme ----------
let rec = null;
export const isRecording = () => !!rec;
export async function toggleRecording(onState) {
  if (rec) { rec.mr.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { throw new Error('Kein Mikrofon gefunden oder der Zugriff wurde verweigert.'); }
  const mr = new MediaRecorder(stream); const chunks = []; const startTime = S.time;
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop()); pause(); rec = null;
    try {
      const path = await api.saveRecording(await new Blob(chunks, { type: mr.mimeType }).arrayBuffer());
      const m = await importPaths([path]); if (!m) throw new Error('Die Aufnahme konnte nicht geladen werden.');
      m.name = `Sprachaufnahme ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`; renderMedia();
      addMedia(m, { time: startTime }); onState(false, 'Aufnahme eingefügt.');
    } catch (e) { onState(false, errText(e), true); }
  };
  mr.start(250); rec = { mr }; play(); onState(true, 'Aufnahme läuft …');
}

// ---------- Untertitel als SRT ----------
const srtTime = (t) => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
export function buildSrt() {
  let list = S.project.clips.filter((c) => c.type === 'text' && c.caption);
  if (!list.length) list = S.project.clips.filter((c) => c.type === 'text');
  list.sort((a, b) => a.start - b.start);
  return list.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(clipEnd(c))}\n${c.text}\n`).join('\n');
}
export function parseSrt(text) {
  const caps = []; const toSec = (s) => { const [h, m, r] = s.replace(',', '.').split(':'); return (+h) * 3600 + (+m) * 60 + parseFloat(r); };
  const re = /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)[^\n]*\n([\s\S]*?)(?=\n\s*\n|\s*$)/g; let m;
  const src = text.replace(/\r/g, '');
  while ((m = re.exec(src))) { const t = m[3].replace(/<[^>]+>/g, '').trim(); if (t) caps.push({ start: toSec(m[1]), end: toSec(m[2]), text: t }); }
  return caps.filter((c) => c.end > c.start);
}
export async function exportSrt() {
  const srt = buildSrt(); if (!srt) { toast('Es gibt noch keine Untertitel oder Texte.'); return; }
  const path = await api.saveFileDialog({ title: 'Untertitel speichern', name: `${S.project.name}.srt`, filters: [{ name: 'SRT-Untertitel', extensions: ['srt'] }] });
  if (!path) return;
  try { await api.writeFile(path, srt); toast('Untertitel gespeichert.', 'ok'); } catch (e) { toast(errText(e), 'error'); }
}
export async function importSrt() {
  const r = await api.openText({ title: 'Untertitel laden', filters: [{ name: 'SRT-Untertitel', extensions: ['srt', 'txt'] }] });
  if (!r) return;
  const caps = parseSrt(r.text); if (!caps.length) { toast('In dieser Datei wurden keine Untertitel gefunden.', 'error'); return; }
  insertCaptions(caps); toast(`${caps.length} Untertitel geladen.`, 'ok');
}
