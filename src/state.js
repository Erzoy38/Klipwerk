// Projektmodell, Auswahl, Undo/Redo und ein kleiner Ereignisbus
export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const mediaUrl = (p) => `app://klipwerk/__media__?p=${encodeURIComponent(p)}`;

const listeners = {};
export function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
export function emit(ev, data) { (listeners[ev] || []).forEach((fn) => fn(data)); }

function defaultTracks() {
  return [
    { id: uid('tr'), kind: 'text', name: 'Text', muted: false, hidden: false },
    { id: uid('tr'), kind: 'video', name: 'Video 2', muted: false, hidden: false },
    { id: uid('tr'), kind: 'video', name: 'Video 1', muted: false, hidden: false },
    { id: uid('tr'), kind: 'audio', name: 'Audio 1', muted: false, hidden: false },
    { id: uid('tr'), kind: 'audio', name: 'Audio 2', muted: false, hidden: false },
  ];
}

export function newProject() {
  return { version: 1, name: 'Mein Video', width: 1920, height: 1080, fps: 30, media: [], tracks: defaultTracks(), clips: [] };
}

export const S = {
  project: newProject(),
  selection: null,     // Clip-ID
  time: 0,
  pps: 80,             // Pixel pro Sekunde in der Timeline
  snap: true,
  filePath: null,
  dirty: false,
};

export const FILTER_DEFAULT = { preset: 'none', brightness: 100, contrast: 100, saturation: 100, hue: 0, sepia: 0, gray: 0, blur: 0 };

export function visualDefaults() {
  return {
    x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flip: false,
    filter: { ...FILTER_DEFAULT }, fx: {}, blend: 'source-over', kf: {},
    animIn: { type: 'none', dur: 0.5 }, animOut: { type: 'none', dur: 0.5 },
  };
}
export function mediaVisualDefaults() {
  return {
    bg: { remove: false, mode: 'transparent', color: '#00b140', invert: false },
    crop: { l: 0, r: 0, t: 0, b: 0 }, mask: 'none',
    chroma: { on: false, color: '#00d430', tol: 0.28, soft: 0.12 },
  };
}
export function audioDefaults() {
  return { volume: 1, fadeIn: 0, fadeOut: 0, muted: false, afx: 'none', afxPath: null };
}

// Ältere Projektdateien auf den aktuellen Stand bringen
export function migrateProject(p) {
  for (const c of p.clips) {
    if (c.type !== 'audio') { c.blend ||= 'source-over'; c.kf ||= {}; }
    if (c.type === 'video' || c.type === 'image') { const d = mediaVisualDefaults(); for (const k of Object.keys(d)) c[k] ||= d[k]; }
    if (c.type === 'video' || c.type === 'audio') {
      if (c.afx == null) { c.afx = c.enhance ? 'enhance' : 'none'; c.afxPath = c.enhancedPath || null; }
      delete c.enhance; delete c.enhancedPath;
    }
  }
  return p;
}

// ---------- Keyframes: Werte, die sich über die Clipdauer verändern ----------
export const KF_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'];
const KF_EPS = 0.045;
export function evalProp(clip, name, local) {
  const k = clip.kf && clip.kf[name];
  if (!k || !k.length) return clip[name];
  if (local <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (local >= last.t) return last.v;
  for (let i = 1; i < k.length; i++) {
    if (local <= k[i].t) {
      const a = k[i - 1], b = k[i]; let u = (local - a.t) / Math.max(1e-6, b.t - a.t);
      u = u * u * (3 - 2 * u);
      return a.v + (b.v - a.v) * u;
    }
  }
  return last.v;
}
export const localTime = (clip) => clamp(S.time - clip.start, 0, clip.duration);
export const hasKf = (clip) => !!clip.kf && KF_PROPS.some((n) => clip.kf[n] && clip.kf[n].length);
export const kfTimes = (clip) => { const set = new Set(); if (clip.kf) for (const n of KF_PROPS) for (const k of clip.kf[n] || []) set.add(+k.t.toFixed(3)); return [...set].sort((a, b) => a - b); };
export const kfAt = (clip, local) => kfTimes(clip).some((t) => Math.abs(t - local) < KF_EPS);
function putKey(clip, name, local, v) {
  const arr = (clip.kf[name] ||= []);
  const hit = arr.find((k) => Math.abs(k.t - local) < KF_EPS);
  if (hit) hit.v = v; else { arr.push({ t: local, v }); arr.sort((a, b) => a.t - b.t); }
}
// Setzt einen Wert; gibt es für die Eigenschaft Keyframes, wird an der aktuellen Stelle einer geschrieben
export function setProp(clip, name, value, local = localTime(clip)) {
  if (clip.kf && clip.kf[name] && clip.kf[name].length) putKey(clip, name, local, value); else clip[name] = value;
}
export function toggleKeyframe(clip, local = localTime(clip)) {
  clip.kf ||= {};
  if (kfAt(clip, local)) {
    for (const n of KF_PROPS) {
      if (!clip.kf[n]) continue;
      const v = evalProp(clip, n, local);
      clip.kf[n] = clip.kf[n].filter((k) => Math.abs(k.t - local) >= KF_EPS);
      if (!clip.kf[n].length) { delete clip.kf[n]; clip[n] = v; }
    }
    return false;
  }
  for (const n of KF_PROPS) putKey(clip, n, local, evalProp(clip, n, local));
  return true;
}
export function clearKeyframes(clip) { const l = localTime(clip); for (const n of KF_PROPS) clip[n] = evalProp(clip, n, l); clip.kf = {}; }
export function shiftKeyframes(clip, delta) { if (!clip.kf) return; for (const n of KF_PROPS) for (const k of clip.kf[n] || []) k.t -= delta; }

export function makeMediaClip(media, trackId, start) {
  const base = { id: uid('c'), trackId, mediaId: media.id, start, offset: 0, speed: 1 };
  if (media.type === 'audio') return { ...base, type: 'audio', duration: media.duration, ...audioDefaults() };
  if (media.type === 'image') return { ...base, type: 'image', duration: 5, ...visualDefaults(), ...mediaVisualDefaults() };
  return { ...base, type: 'video', duration: media.duration, ...visualDefaults(), ...audioDefaults(), ...mediaVisualDefaults() };
}

export function makeTextClip(trackId, start, style = {}) {
  return {
    id: uid('c'), trackId, type: 'text', start, duration: 4, offset: 0, speed: 1,
    ...visualDefaults(),
    text: 'Dein Text', font: 'Segoe UI', size: 96, color: '#ffffff', bold: true, italic: false, align: 'center',
    stroke: '#000000', strokeWidth: 0, bgColor: '#000000', bgOpacity: 0, shadow: 0.5, lineHeight: 1.15, caption: false,
    ...style,
  };
}

export const getClip = (id) => S.project.clips.find((c) => c.id === id) || null;
export const getMedia = (id) => S.project.media.find((m) => m.id === id) || null;
export const getTrack = (id) => S.project.tracks.find((t) => t.id === id) || null;
export const selectedClip = () => getClip(S.selection);
export const clipEnd = (c) => c.start + c.duration;
export const projectDuration = () => S.project.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
export const trackClips = (trackId) => S.project.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
export const kindOfClip = (c) => (c.type === 'text' ? 'text' : c.type === 'audio' ? 'audio' : 'video');

// Maximale Länge eines Medienclips (Bilder und Text sind beliebig lang)
export function maxDuration(clip) {
  if (clip.type === 'video' || clip.type === 'audio') {
    const m = getMedia(clip.mediaId);
    if (m) return Math.max(0.05, (m.duration - clip.offset) / clip.speed);
  }
  return Infinity;
}

// Sucht die nächste freie Startposition auf einer Spur (keine Überlappung)
export function freeStart(trackId, start, duration, ignoreId) {
  const others = trackClips(trackId).filter((c) => c.id !== ignoreId);
  let s = Math.max(0, start);
  for (let guard = 0; guard < 200; guard++) {
    const hit = others.find((c) => s < clipEnd(c) - 1e-6 && s + duration > c.start + 1e-6);
    if (!hit) return s;
    // Lücke davor nutzen, wenn der Clip dort hinpasst und näher liegt
    const prevEnd = others.filter((c) => clipEnd(c) <= hit.start + 1e-6).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const before = hit.start - duration;
    if (before >= prevEnd - 1e-6 && before >= 0 && Math.abs(before - start) < Math.abs(clipEnd(hit) - start)) return before;
    s = clipEnd(hit);
  }
  return s;
}

export function firstTrack(kind) { return S.project.tracks.filter((t) => t.kind === kind); }

// ---------- Undo / Redo ----------
const undoStack = []; const redoStack = [];
let lastSnap = null;
const snap = () => JSON.stringify({ tracks: S.project.tracks, clips: S.project.clips, width: S.project.width, height: S.project.height, fps: S.project.fps });

export function initHistory() { undoStack.length = 0; redoStack.length = 0; lastSnap = snap(); }
export function commit() {
  const now = snap();
  if (now === lastSnap) return;
  undoStack.push(lastSnap); if (undoStack.length > 150) undoStack.shift();
  redoStack.length = 0; lastSnap = now; S.dirty = true;
  emit('history');
}
function restore(json) {
  const d = JSON.parse(json);
  Object.assign(S.project, d);
  if (S.selection && !getClip(S.selection)) S.selection = null;
  lastSnap = json; S.dirty = true;
  emit('project'); emit('selection'); emit('history');
}
export function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); }
export function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); }
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function select(id) { if (S.selection === id) return; S.selection = id; emit('selection'); }
export function changed() { emit('project'); }           // Struktur geändert (Timeline neu aufbauen)
export function touched() { emit('render'); }             // nur Eigenschaften geändert (Vorschau neu zeichnen)

export function fmtTime(t, fps = 30) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * fps + 1e-6);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export function toast(msg, kind = 'info', ms = 3800) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`; el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}
