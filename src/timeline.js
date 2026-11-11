// Timeline: Spuren, Clips verschieben/trimmen/teilen, Einrasten, Lineal, Abspielkopf
import {
  S, on, emit, uid, clamp, getClip, getMedia, getTrack, trackClips, clipEnd, kindOfClip, maxDuration, freeStart, projectDuration,
  select, commit, changed, makeMediaClip, makeTextClip, fmtTime, toast,
} from './state.js';
import { seek, pause, player } from './player.js';

const scroll = document.getElementById('tlScroll');
const inner = document.getElementById('tlInner');
const rows = document.getElementById('tlRows');
const ruler = document.getElementById('ruler');
const playhead = document.getElementById('playhead');
const HDR = 140;

const zoomToPps = (z) => 4 * Math.pow(100, z / 100);          // 4 … 400 px/s
const ppsToZoom = (p) => (Math.log(p / 4) / Math.log(100)) * 100;

function contentWidth() { return Math.max(scroll.clientWidth - HDR, (projectDuration() + 20) * S.pps); }

export function build() {
  const P = S.project;
  inner.style.width = `${HDR + contentWidth()}px`;
  rows.textContent = '';
  for (const tr of P.tracks) {
    const row = document.createElement('div'); row.className = `tl-row ${tr.kind}`;
    const head = document.createElement('div'); head.className = 'tl-head';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = tr.name; head.appendChild(nm);
    if (tr.kind !== 'audio') {
      const b = document.createElement('button'); b.textContent = tr.hidden ? '🚫' : '👁'; b.title = 'Spur ein-/ausblenden'; b.className = tr.hidden ? 'off' : '';
      b.onclick = () => { tr.hidden = !tr.hidden; commit(); changed(); }; head.appendChild(b);
    }
    if (tr.kind !== 'text') {
      const b = document.createElement('button'); b.textContent = tr.muted ? '🔇' : '🔊'; b.title = 'Spur stummschalten'; b.className = tr.muted ? 'off' : '';
      b.onclick = () => { tr.muted = !tr.muted; commit(); changed(); }; head.appendChild(b);
    }
    const del = document.createElement('button'); del.textContent = '✕'; del.title = 'Spur löschen';
    del.onclick = () => removeTrack(tr.id); head.appendChild(del);
    const lane = document.createElement('div'); lane.className = 'lane'; lane.dataset.track = tr.id; lane.dataset.kind = tr.kind;
    for (const c of P.clips) if (c.trackId === tr.id) lane.appendChild(clipEl(c));
    row.append(head, lane); rows.appendChild(row);
  }
  drawRuler(); placePlayhead();
}

function clipLabel(c) {
  if (c.type === 'text') return c.text.replace(/\n/g, ' ');
  return getMedia(c.mediaId)?.name || 'Clip';
}
function clipEl(c) {
  const el = document.createElement('div');
  el.className = `clip ${c.type}${c.id === S.selection ? ' selected' : ''}`; el.dataset.id = c.id;
  el.style.left = `${c.start * S.pps}px`; el.style.width = `${Math.max(3, c.duration * S.pps)}px`;
  const m = getMedia(c.mediaId);
  if ((c.type === 'video' || c.type === 'image') && m?.thumb) el.style.backgroundImage = `url("${m.thumb}")`;
  const shade = document.createElement('div'); shade.className = 'shade';
  const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = clipLabel(c);
  const tags = document.createElement('div'); tags.className = 'tags';
  const tag = (t) => { const s = document.createElement('span'); s.textContent = t; tags.appendChild(s); };
  if (c.speed && c.speed !== 1) tag(`${c.speed}x`);
  if (c.bg?.remove) tag('Freigestellt');
  if (c.enhance) tag('Audio+');
  if (c.fx && Object.keys(c.fx).length) tag('FX');
  if (c.filter && c.filter.preset !== 'none') tag('Filter');
  const hl = document.createElement('div'); hl.className = 'h l';
  const hr = document.createElement('div'); hr.className = 'h r';
  el.append(shade, lbl, tags, hl, hr);
  return el;
}

function drawRuler() {
  const w = Math.max(50, scroll.clientWidth - HDR), dpr = window.devicePixelRatio || 1;
  ruler.style.width = `${w}px`; ruler.width = Math.round(w * dpr); ruler.height = Math.round(26 * dpr);
  const c = ruler.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, 26);
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((s) => s * S.pps >= 70) || 600;
  const x0 = scroll.scrollLeft, t0 = Math.floor(x0 / S.pps / step) * step;
  c.font = '10px Consolas, monospace'; c.fillStyle = '#8a90a2'; c.strokeStyle = '#3a3f4e'; c.lineWidth = 1;
  for (let t = t0; (t * S.pps - x0) < w; t += step) {
    const x = Math.round(t * S.pps - x0) + 0.5;
    c.beginPath(); c.moveTo(x, 12); c.lineTo(x, 26); c.stroke();
    const mm = Math.floor(t / 60), ss = t % 60;
    c.fillText(step < 1 ? `${mm}:${ss.toFixed(2).padStart(5, '0')}` : `${mm}:${String(Math.round(ss)).padStart(2, '0')}`, x + 4, 11);
    for (let i = 1; i < 5; i++) { const xs = Math.round((t + (step * i) / 5) * S.pps - x0) + 0.5; c.beginPath(); c.moveTo(xs, 20); c.lineTo(xs, 26); c.stroke(); }
  }
}

function placePlayhead() { playhead.style.left = `${HDR + S.time * S.pps}px`; }
function followPlayhead() {
  const x = S.time * S.pps, vw = scroll.clientWidth - HDR;
  if (x < scroll.scrollLeft || x > scroll.scrollLeft + vw - 30) scroll.scrollLeft = Math.max(0, x - vw * 0.15);
}

// ---------- Aktionen ----------
export function addMedia(media, opts = {}) {
  const kind = media.type === 'audio' ? 'audio' : 'video';
  const tracks = S.project.tracks.filter((t) => t.kind === kind);
  if (!tracks.length) { toast('Keine passende Spur vorhanden – füge eine Spur hinzu.', 'error'); return null; }
  let track = opts.trackId ? getTrack(opts.trackId) : null;
  if (!track || track.kind !== kind) track = kind === 'video' ? tracks[tracks.length - 1] : tracks[0];
  const clip = makeMediaClip(media, track.id, 0);
  clip.start = freeStart(track.id, opts.time ?? S.time, clip.duration);
  S.project.clips.push(clip);
  select(clip.id); commit(); changed();
  return clip;
}
export function addText(style = {}, opts = {}) {
  let track = opts.trackId ? getTrack(opts.trackId) : S.project.tracks.find((t) => t.kind === 'text');
  if (!track) { track = { id: uid('tr'), kind: 'text', name: 'Text', muted: false, hidden: false }; S.project.tracks.unshift(track); }
  const clip = makeTextClip(track.id, 0, style);
  if (opts.duration) clip.duration = opts.duration;
  clip.start = freeStart(track.id, opts.time ?? S.time, clip.duration);
  S.project.clips.push(clip);
  if (!opts.silent) { select(clip.id); commit(); changed(); }
  return clip;
}

export function splitAtPlayhead() {
  const t = S.time; const sel = getClip(S.selection);
  const targets = (sel ? [sel] : S.project.clips).filter((c) => t > c.start + 0.04 && t < clipEnd(c) - 0.04);
  if (!targets.length) { toast('Der Abspielkopf liegt auf keinem Clip.'); return; }
  for (const c of targets) {
    const b = JSON.parse(JSON.stringify(c)); b.id = uid('c');
    const end = clipEnd(c);
    c.duration = t - c.start;
    b.start = t; b.duration = end - t; b.offset = c.offset + (t - c.start) * c.speed;
    if (c.animOut) c.animOut = { ...c.animOut, type: 'none' };
    if (b.animIn) b.animIn = { ...b.animIn, type: 'none' };
    if ('fadeOut' in c) c.fadeOut = 0;
    if ('fadeIn' in b) b.fadeIn = 0;
    S.project.clips.push(b);
    if (sel) S.selection = b.id;
  }
  commit(); changed(); emit('selection');
}
export function deleteSelected() {
  const c = getClip(S.selection); if (!c) return;
  S.project.clips = S.project.clips.filter((x) => x.id !== c.id);
  S.selection = null; commit(); changed(); emit('selection');
}
export function duplicateSelected() {
  const c = getClip(S.selection); if (!c) return;
  const b = JSON.parse(JSON.stringify(c)); b.id = uid('c');
  b.start = freeStart(c.trackId, clipEnd(c), c.duration);
  S.project.clips.push(b); S.selection = b.id; commit(); changed(); emit('selection');
}
export function addTrack(kind) {
  const P = S.project; const n = P.tracks.filter((t) => t.kind === kind).length + 1;
  const tr = { id: uid('tr'), kind, name: `${kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Text'} ${n}`, muted: false, hidden: false };
  if (kind === 'audio') P.tracks.push(tr);
  else if (kind === 'text') P.tracks.unshift(tr);
  else { const i = P.tracks.findIndex((t) => t.kind === 'video'); P.tracks.splice(i < 0 ? P.tracks.filter((t) => t.kind === 'text').length : i, 0, tr); }
  commit(); changed();
}
function removeTrack(id) {
  const P = S.project; const has = P.clips.some((c) => c.trackId === id);
  if (has && !confirm('Diese Spur enthält Clips. Spur und Clips wirklich löschen?')) return;
  P.clips = P.clips.filter((c) => c.trackId !== id);
  P.tracks = P.tracks.filter((t) => t.id !== id);
  if (S.selection && !getClip(S.selection)) { S.selection = null; emit('selection'); }
  commit(); changed();
}

export function setZoom(pps, anchorX) {
  const old = S.pps; pps = clamp(pps, 4, 400);
  if (Math.abs(pps - old) < 0.001) return;
  const ax = anchorX ?? (S.time * old - scroll.scrollLeft);
  const tAnchor = (scroll.scrollLeft + ax) / old;
  S.pps = pps; build();
  scroll.scrollLeft = Math.max(0, tAnchor * pps - ax);
  document.getElementById('zoom').value = ppsToZoom(pps);
  drawRuler();
}
export function fitZoom() {
  const d = projectDuration(); if (d <= 0) return;
  setZoom((scroll.clientWidth - HDR - 40) / d); scroll.scrollLeft = 0; drawRuler();
}

// ---------- Maus-Interaktion ----------
let drag = null; let snapLine = null;
const timeAt = (clientX) => (clientX - scroll.getBoundingClientRect().left - HDR + scroll.scrollLeft) / S.pps;

function snapTime(t, ignoreId, extra = []) {
  if (!S.snap) return { t, hit: false };
  const tol = 8 / S.pps; let best = null;
  const cands = [0, S.time, ...extra];
  for (const c of S.project.clips) if (c.id !== ignoreId) cands.push(c.start, clipEnd(c));
  for (const x of cands) { const d = Math.abs(x - t); if (d <= tol && (!best || d < best.d)) best = { d, x }; }
  return best ? { t: best.x, hit: true } : { t, hit: false };
}
function showSnap(t) {
  if (t == null) { snapLine?.remove(); snapLine = null; return; }
  if (!snapLine) { snapLine = document.createElement('div'); snapLine.className = 'snapline'; inner.appendChild(snapLine); }
  snapLine.style.left = `${HDR + t * S.pps}px`;
}
function styleClip(c) {
  const el = rows.querySelector(`.clip[data-id="${c.id}"]`); if (!el) return;
  el.style.left = `${c.start * S.pps}px`; el.style.width = `${Math.max(3, c.duration * S.pps)}px`;
  const lane = rows.querySelector(`.lane[data-track="${c.trackId}"]`);
  if (lane && el.parentElement !== lane) lane.appendChild(el);
}

rows.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || player.exporting) return;
  const clipNode = ev.target.closest('.clip');
  if (!clipNode) {
    if (ev.target.closest('.tl-head')) return;
    select(null); pause(); seek(timeAt(ev.clientX)); drag = { mode: 'scrub' }; rows.setPointerCapture(ev.pointerId); return;
  }
  const c = getClip(clipNode.dataset.id); if (!c) return;
  select(c.id);
  const mode = ev.target.classList.contains('l') && ev.target.classList.contains('h') ? 'trimL'
    : ev.target.classList.contains('r') && ev.target.classList.contains('h') ? 'trimR' : 'move';
  const sibs = trackClips(c.trackId).filter((x) => x.id !== c.id);
  drag = {
    mode, clip: c, x0: ev.clientX, start0: c.start, dur0: c.duration, off0: c.offset, track0: c.trackId, moved: false,
    prevEnd: sibs.filter((x) => clipEnd(x) <= c.start + 1e-6).reduce((m, x) => Math.max(m, clipEnd(x)), 0),
    nextStart: sibs.filter((x) => x.start >= clipEnd(c) - 1e-6).reduce((m, x) => Math.min(m, x.start), Infinity),
  };
  rows.setPointerCapture(ev.pointerId);
});

rows.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (drag.mode === 'scrub') { seek(timeAt(ev.clientX)); return; }
  const c = drag.clip; const dt = (ev.clientX - drag.x0) / S.pps;
  if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 3) return;
  drag.moved = true;
  const isMedia = c.type === 'video' || c.type === 'audio';
  if (drag.mode === 'move') {
    let ns = Math.max(0, drag.start0 + dt);
    const a = snapTime(ns, c.id), b = snapTime(ns + c.duration, c.id);
    if (a.hit) { ns = a.t; showSnap(a.t); } else if (b.hit) { ns = Math.max(0, b.t - c.duration); showSnap(b.t); } else showSnap(null);
    c.start = ns;
    const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.lane');
    if (lane && lane.dataset.kind === kindOfClip(c)) c.trackId = lane.dataset.track;
  } else if (drag.mode === 'trimL') {
    const end = drag.start0 + drag.dur0;
    let ns = drag.start0 + dt;
    const s = snapTime(ns, c.id); if (s.hit) { ns = s.t; showSnap(s.t); } else showSnap(null);
    const minStart = Math.max(0, drag.prevEnd, isMedia ? drag.start0 - drag.off0 / c.speed : -Infinity);
    ns = clamp(ns, minStart, end - 0.1);
    c.start = ns; c.duration = end - ns;
    if (isMedia) c.offset = Math.max(0, drag.off0 + (ns - drag.start0) * c.speed);
  } else {
    let ne = drag.start0 + drag.dur0 + dt;
    const s = snapTime(ne, c.id); if (s.hit) { ne = s.t; showSnap(s.t); } else showSnap(null);
    ne = clamp(ne, c.start + 0.1, Math.min(drag.nextStart, c.start + maxDuration(c)));
    c.duration = ne - c.start;
  }
  styleClip(c); emit('render'); emit('props');
});

const endDrag = () => {
  if (!drag) return;
  const d = drag; drag = null; showSnap(null);
  if (d.mode === 'scrub' || !d.moved) return;
  if (d.mode === 'move') d.clip.start = freeStart(d.clip.trackId, d.clip.start, d.clip.duration, d.clip.id);
  commit(); changed();
};
rows.addEventListener('pointerup', endDrag);
rows.addEventListener('pointercancel', endDrag);

let rulerDrag = false;
ruler.addEventListener('pointerdown', (ev) => { rulerDrag = true; ruler.setPointerCapture(ev.pointerId); pause(); seek(timeAt(ev.clientX)); });
ruler.addEventListener('pointermove', (ev) => { if (rulerDrag) seek(timeAt(ev.clientX)); });
ruler.addEventListener('pointerup', () => { rulerDrag = false; });
ruler.addEventListener('pointercancel', () => { rulerDrag = false; });

scroll.addEventListener('scroll', drawRuler);
scroll.addEventListener('wheel', (ev) => {
  if (ev.ctrlKey) { ev.preventDefault(); setZoom(S.pps * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), ev.clientX - scroll.getBoundingClientRect().left - HDR); }
}, { passive: false });
new ResizeObserver(() => { inner.style.width = `${HDR + contentWidth()}px`; drawRuler(); }).observe(scroll);

// Medien aus der Bibliothek in eine Spur ziehen
rows.addEventListener('dragover', (ev) => {
  if (!ev.dataTransfer.types.includes('application/x-klipwerk-media')) return;
  ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy';
  rows.querySelectorAll('.lane.drop').forEach((l) => l.classList.remove('drop'));
  ev.target.closest?.('.lane')?.classList.add('drop');
});
rows.addEventListener('dragleave', () => rows.querySelectorAll('.lane.drop').forEach((l) => l.classList.remove('drop')));
rows.addEventListener('drop', (ev) => {
  const id = ev.dataTransfer.getData('application/x-klipwerk-media'); if (!id) return;
  ev.preventDefault();
  rows.querySelectorAll('.lane.drop').forEach((l) => l.classList.remove('drop'));
  const media = getMedia(id); if (!media) return;
  const lane = ev.target.closest?.('.lane');
  addMedia(media, { time: Math.max(0, snapTime(timeAt(ev.clientX)).t), trackId: lane?.dataset.track });
});

// Toolbar
document.getElementById('btnSplit').onclick = splitAtPlayhead;
document.getElementById('btnDelete').onclick = deleteSelected;
document.getElementById('btnDup').onclick = duplicateSelected;
document.getElementById('btnFit').onclick = fitZoom;
document.getElementById('snap').onchange = (e) => { S.snap = e.target.checked; };
document.getElementById('zoom').oninput = (e) => setZoom(zoomToPps(+e.target.value));
document.getElementById('btnAddTrack').onclick = (ev) => {
  document.querySelector('.menu')?.remove();
  const m = document.createElement('div'); m.className = 'menu';
  for (const [k, n] of [['video', 'Videospur'], ['audio', 'Audiospur'], ['text', 'Textspur']]) {
    const b = document.createElement('button'); b.textContent = n; b.onclick = () => { m.remove(); addTrack(k); }; m.appendChild(b);
  }
  const r = ev.currentTarget.getBoundingClientRect();
  m.style.left = `${r.left}px`; m.style.bottom = `${window.innerHeight - r.top + 4}px`;
  document.body.appendChild(m);
  setTimeout(() => window.addEventListener('pointerdown', (e) => { if (!m.contains(e.target)) m.remove(); }, { once: true }), 0);
};

on('project', build);
on('selection', () => {
  rows.querySelectorAll('.clip.selected').forEach((e) => e.classList.remove('selected'));
  if (S.selection) rows.querySelector(`.clip[data-id="${S.selection}"]`)?.classList.add('selected');
});
on('time', () => {
  placePlayhead(); if (player.playing) followPlayhead();
  document.getElementById('timeNow').textContent = fmtTime(S.time, S.project.fps);
});
on('labels', build);
document.getElementById('zoom').value = ppsToZoom(S.pps);
