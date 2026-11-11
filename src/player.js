// Wiedergabe: Medienelemente je Clip, Synchronisation zur Timeline, Vorschau zeichnen, Clips in der Vorschau anfassen
import { S, emit, on, getMedia, getClip, mediaUrl, clamp, projectDuration, select, commit, touched } from './state.js';
import { drawFrame, clipBounds, hitTest, isAudible } from './render.js';
import { segmenter } from './ai/segmenter.js';

const canvas = document.getElementById('preview');
const overlay = document.getElementById('overlay');
const wrap = document.getElementById('canvasWrap');
const viewport = document.getElementById('viewport');

const pool = new Map(); // Clip-ID -> { key, type, el, aux }
let dirty = true; let last = performance.now();

export const player = { playing: false, exporting: false };
export const requestDraw = () => { dirty = true; };

function makeMediaEl(tag, url) {
  const el = document.createElement(tag);
  el.preload = 'auto'; el.playsInline = true; el.crossOrigin = 'anonymous';
  el.src = url;
  el.addEventListener('seeked', () => {
    if (el._pending != null) { const p = el._pending; el._pending = null; if (Math.abs(el.currentTime - p) > 0.015) el.currentTime = p; }
    dirty = true;
  });
  el.addEventListener('loadeddata', () => { dirty = true; });
  el.addEventListener('canplay', () => { dirty = true; });
  return el;
}
function disposeEntry(e) {
  for (const el of [e.el, e.aux]) {
    if (!el || el.tagName === 'IMG') continue;
    try { el.pause(); el.removeAttribute('src'); el.load(); } catch {}
  }
}

function ensure(clip) {
  const media = getMedia(clip.mediaId);
  if (!media) return null;
  const enh = clip.enhance && clip.enhancedPath ? clip.enhancedPath : '';
  const key = `${media.path}|${enh}`;
  let e = pool.get(clip.id);
  if (e && e.key === key) return e;
  if (e) disposeEntry(e);
  e = { key, type: clip.type, el: null, aux: null };
  if (clip.type === 'image') {
    e.el = new Image(); e.el.onload = () => { dirty = true; }; e.el.src = mediaUrl(media.path);
  } else if (clip.type === 'audio') {
    e.el = makeMediaEl('audio', mediaUrl(enh || media.path));
  } else {
    e.el = makeMediaEl('video', mediaUrl(media.path));
    if (enh) e.aux = makeMediaEl('audio', mediaUrl(enh));
  }
  pool.set(clip.id, e);
  return e;
}

function seekTo(el, t) {
  if (Math.abs(el.currentTime - t) < 0.015) return;
  if (el.seeking) { el._pending = t; return; }
  el.currentTime = t;
}

function fadeGain(clip, local) {
  let g = 1;
  if (clip.fadeIn > 0 && local < clip.fadeIn) g *= local / clip.fadeIn;
  if (clip.fadeOut > 0 && clip.duration - local < clip.fadeOut) g *= (clip.duration - local) / clip.fadeOut;
  return clamp(g, 0, 1);
}

function sync() {
  const t = S.time; const live = new Set();
  let master = null;
  for (const clip of S.project.clips) {
    if (clip.type === 'text') continue;
    live.add(clip.id);
    const near = t >= clip.start - 2 && t < clip.start + clip.duration + 0.25;
    if (!near) {
      const e = pool.get(clip.id);
      if (e && e.type !== 'image') { for (const el of [e.el, e.aux]) if (el && !el.paused) el.pause(); }
      continue;
    }
    const e = ensure(clip);
    if (!e || clip.type === 'image') continue;
    const active = t >= clip.start && t < clip.start + clip.duration;
    const local = clamp(t - clip.start, 0, clip.duration);
    const src = clip.offset + local * clip.speed;
    const vol = active && isAudible(clip) ? clamp(clip.volume * fadeGain(clip, local), 0, 1) : 0;
    for (const el of [e.el, e.aux]) {
      if (!el) continue;
      const carriesAudio = e.aux ? el === e.aux : true;
      const v = carriesAudio ? vol : 0;
      if (el.volume !== v) el.volume = v;
      el.muted = v === 0;
      if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
      if (active && player.playing) {
        if (el.paused) {
          if (Math.abs(el.currentTime - src) > 0.05) el.currentTime = src;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - src) > 0.4) el.currentTime = src;
        else if (!master && el === e.el && el.readyState >= 3 && !el.seeking) master = { clip, el };
      } else {
        if (!el.paused) el.pause();
        seekTo(el, active ? src : clip.offset);
      }
    }
  }
  // Zeit sanft an das führende Medium koppeln, damit Bild und Ton nicht auseinanderlaufen
  if (master && player.playing) {
    const implied = master.clip.start + (master.el.currentTime - master.clip.offset) / master.clip.speed;
    if (Math.abs(implied - S.time) < 0.4) S.time += (implied - S.time) * 0.15;
  }
  // Aufräumen: gelöschte Clips sofort, weit entfernte bei vollem Pool
  for (const [id, e] of pool) {
    if (!live.has(id)) { disposeEntry(e); pool.delete(id); continue; }
    if (pool.size > 10) {
      const c = getClip(id);
      if (c && (t < c.start - 6 || t > c.start + c.duration + 6)) { disposeEntry(e); pool.delete(id); }
    }
  }
}

const env = {
  segmenter,
  getSource(clip) {
    const e = ensure(clip);
    if (!e) return null;
    const el = e.el;
    if (clip.type === 'image') return el.complete && el.naturalWidth ? { el, w: el.naturalWidth, h: el.naturalHeight } : null;
    return el.readyState >= 2 && el.videoWidth ? { el, w: el.videoWidth, h: el.videoHeight } : null;
  },
};
export const renderEnv = env;

function drawOverlay() {
  const dpr = window.devicePixelRatio || 1;
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (overlay.width !== Math.round(cw * dpr) || overlay.height !== Math.round(ch * dpr)) { overlay.width = Math.round(cw * dpr); overlay.height = Math.round(ch * dpr); }
  const c = overlay.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, overlay.width, overlay.height);
  const clip = getClip(S.selection);
  if (!clip || clip.type === 'audio' || player.playing) return;
  if (S.time < clip.start || S.time >= clip.start + clip.duration) return;
  const b = clipBounds(clip, S.project); const k = (cw / S.project.width) * dpr;
  c.translate(b.cx * k, b.cy * k); c.rotate((b.rot * Math.PI) / 180);
  c.strokeStyle = '#22d3a6'; c.lineWidth = 1.5 * dpr; c.strokeRect((-b.w / 2) * k, (-b.h / 2) * k, b.w * k, b.h * k);
  c.fillStyle = '#fff';
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    c.beginPath(); c.arc((sx * b.w / 2) * k, (sy * b.h / 2) * k, 5 * dpr, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (player.exporting) return;
  if (player.playing) {
    S.time += dt;
    const dur = projectDuration();
    if (S.time >= dur) { S.time = dur; pause(); }
    emit('time'); dirty = true;
  }
  if (!dirty) return;
  dirty = false;
  sync();
  drawFrame(canvas, S.time, env);
  drawOverlay();
}

export function play() {
  if (player.playing || player.exporting) return;
  if (S.time >= projectDuration() - 0.02) S.time = 0;
  player.playing = true; last = performance.now(); dirty = true; emit('playstate');
}
export function pause() {
  if (!player.playing) return;
  player.playing = false; dirty = true; emit('playstate');
  for (const e of pool.values()) for (const el of [e.el, e.aux]) if (el && el.tagName !== 'IMG' && !el.paused) el.pause();
}
export const toggle = () => (player.playing ? pause() : play());
export function seek(t) {
  S.time = clamp(t, 0, Math.max(projectDuration(), 0));
  dirty = true; emit('time');
}

// Vorschaugröße an Projektformat und verfügbaren Platz anpassen
export function layout() {
  const P = S.project;
  const availW = viewport.clientWidth - 28, availH = viewport.clientHeight - 28;
  if (availW <= 0 || availH <= 0) return;
  const k = Math.min(availW / P.width, availH / P.height);
  const cw = Math.max(40, Math.floor(P.width * k)), ch = Math.max(40, Math.floor(P.height * k));
  wrap.style.width = `${cw}px`; wrap.style.height = `${ch}px`;
  canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
  const rk = Math.min(1, Math.max(cw * (window.devicePixelRatio || 1), 640) / P.width);
  const rw = Math.round(P.width * rk), rh = Math.round(P.height * rk);
  if (canvas.width !== rw || canvas.height !== rh) { canvas.width = rw; canvas.height = rh; }
  dirty = true;
}

// ---------- Export-Unterstützung: bildgenaues Positionieren ----------
function waitSeek(el, target) {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(to); el.removeEventListener('seeked', onS); el.removeEventListener('error', fin); resolve(); };
    const onS = () => { if (el.readyState >= 2) fin(); else el.addEventListener('canplay', fin, { once: true }); };
    const to = setTimeout(fin, 5000);
    el.addEventListener('seeked', onS); el.addEventListener('error', fin, { once: true });
    el._pending = null;
    el.currentTime = target;
  });
}
function waitReady(el) {
  if (el.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const to = setTimeout(resolve, 8000);
    el.addEventListener('loadeddata', () => { clearTimeout(to); resolve(); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(to); resolve(); }, { once: true });
  });
}
export async function seekExact(t) {
  const jobs = [];
  for (const clip of S.project.clips) {
    if (clip.type !== 'video' && clip.type !== 'image') continue;
    const active = t >= clip.start - 1e-6 && t < clip.start + clip.duration - 1e-6;
    if (!active) {
      const e = pool.get(clip.id);
      if (e && pool.size > 8 && (t > clip.start + clip.duration + 1 || t < clip.start - 3)) { disposeEntry(e); pool.delete(clip.id); }
      continue;
    }
    const e = ensure(clip);
    if (!e) continue;
    if (clip.type === 'image') { if (!e.el.complete) jobs.push(e.el.decode().catch(() => {})); continue; }
    const el = e.el; if (!el.paused) el.pause();
    el.muted = true;
    const media = getMedia(clip.mediaId);
    const target = clamp(clip.offset + (t - clip.start) * clip.speed, 0, Math.max(0, (media?.duration || 1e9) - 0.02));
    jobs.push((async () => {
      await waitReady(el);
      if (Math.abs(el.currentTime - target) > 0.0005 || el.seeking) await waitSeek(el, target);
    })());
  }
  await Promise.all(jobs);
}

// ---------- Clips in der Vorschau verschieben und skalieren ----------
let drag = null;
function toProject(ev) {
  const r = overlay.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * S.project.width, y: ((ev.clientY - r.top) / r.height) * S.project.height, k: S.project.width / r.width };
}
overlay.addEventListener('pointerdown', (ev) => {
  if (player.exporting || ev.button !== 0) return;
  if (player.playing) pause();
  const p = toProject(ev);
  const sel = getClip(S.selection);
  if (sel && sel.type !== 'audio' && S.time >= sel.start && S.time < sel.start + sel.duration) {
    const b = clipBounds(sel, S.project); const a = (b.rot * Math.PI) / 180;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const hx = b.cx + (sx * b.w / 2) * Math.cos(a) - (sy * b.h / 2) * Math.sin(a);
      const hy = b.cy + (sx * b.w / 2) * Math.sin(a) + (sy * b.h / 2) * Math.cos(a);
      if (Math.hypot(p.x - hx, p.y - hy) < 12 * p.k) {
        drag = { mode: 'scale', clip: sel, s0: sel.scale, d0: Math.max(1, Math.hypot(p.x - b.cx, p.y - b.cy)), cx: b.cx, cy: b.cy };
        overlay.setPointerCapture(ev.pointerId); return;
      }
    }
  }
  const hit = hitTest(p.x, p.y, S.time);
  select(hit ? hit.id : null); dirty = true;
  if (hit) { drag = { mode: 'move', clip: hit, px: p.x, py: p.y, x0: hit.x, y0: hit.y, moved: false }; overlay.setPointerCapture(ev.pointerId); }
});
overlay.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const p = toProject(ev); const c = drag.clip;
  if (drag.mode === 'move') {
    let nx = drag.x0 + (p.x - drag.px), ny = drag.y0 + (p.y - drag.py);
    if (Math.abs(nx) < 14 * p.k) nx = 0; // an der Mitte einrasten
    if (Math.abs(ny) < 14 * p.k) ny = 0;
    if (nx !== c.x || ny !== c.y) drag.moved = true;
    c.x = Math.round(nx); c.y = Math.round(ny);
  } else {
    c.scale = clamp(drag.s0 * (Math.hypot(p.x - drag.cx, p.y - drag.cy) / drag.d0), 0.05, 10);
    drag.moved = true;
  }
  touched(); emit('props');
});
const endDrag = () => { if (drag) { if (drag.moved) commit(); drag = null; } };
overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);
overlay.addEventListener('wheel', (ev) => {
  const c = getClip(S.selection);
  if (!c || c.type === 'audio') return;
  ev.preventDefault();
  c.scale = clamp(c.scale * (ev.deltaY < 0 ? 1.04 : 0.96), 0.05, 10);
  touched(); emit('props');
  clearTimeout(overlay._wt); overlay._wt = setTimeout(commit, 400);
}, { passive: false });

on('render', requestDraw);
on('project', requestDraw);
on('selection', requestDraw);
on('playstate', requestDraw);
new ResizeObserver(layout).observe(viewport);
segmenter.onReady = requestDraw;
requestAnimationFrame(frame);
