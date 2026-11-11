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
    filter: { ...FILTER_DEFAULT }, fx: {},
    animIn: { type: 'none', dur: 0.5 }, animOut: { type: 'none', dur: 0.5 },
  };
}
export function audioDefaults() {
  return { volume: 1, fadeIn: 0, fadeOut: 0, muted: false, enhance: false, enhancedPath: null };
}

export function makeMediaClip(media, trackId, start) {
  const base = { id: uid('c'), trackId, mediaId: media.id, start, offset: 0, speed: 1 };
  if (media.type === 'audio') return { ...base, type: 'audio', duration: media.duration, ...audioDefaults() };
  if (media.type === 'image') return { ...base, type: 'image', duration: 5, ...visualDefaults(), bg: { remove: false, mode: 'transparent', color: '#00b140', invert: false } };
  return { ...base, type: 'video', duration: media.duration, ...visualDefaults(), ...audioDefaults(), bg: { remove: false, mode: 'transparent', color: '#00b140', invert: false } };
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
