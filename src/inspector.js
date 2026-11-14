// Eigenschaften-Leiste rechts: zeigt und ändert die Werte des ausgewählten Clips
import {
  S, on, emit, getMedia, selectedClip, commit, touched, changed, maxDuration, trackClips, clipEnd, clamp, FILTER_DEFAULT,
  evalProp, setProp, localTime, hasKf, kfAt, toggleKeyframe, clearKeyframes,
} from './state.js';
import { freezeFrame, detachAudio, reverseClip, removeSilence } from './tools.js';
import { splitAtPlayhead, duplicateSelected, rippleDelete } from './timeline.js';
import { FX_LIST, FILTER_PRESETS, ANIMS_IN, ANIMS_OUT } from './effects.js';

const body = document.getElementById('inspBody');
let updaters = [];
const FONTS = ['Segoe UI', 'Arial', 'Bahnschrift', 'Impact', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Comic Sans MS', 'Courier New', 'Consolas'];

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function section(title, onReset) {
  const s = h('div', 'sect'); const hd = h('h3', null, title);
  if (onReset) { const b = h('button', 'btn', 'Zurücksetzen'); b.onclick = onReset; hd.appendChild(b); }
  s.appendChild(hd); body.appendChild(s); return s;
}
function slider(parent, label, get, set, min, max, step, fmt = (v) => v, relabel = false) {
  const f = h('div', 'fld'); const inp = h('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
  const val = h('span', 'val');
  const upd = () => { const v = get(); if (document.activeElement !== inp) inp.value = v; val.textContent = fmt(v); };
  inp.oninput = () => { set(parseFloat(inp.value)); val.textContent = fmt(get()); touched(); };
  inp.onchange = () => { commit(); if (relabel) emit('labels'); };
  f.append(h('label', null, label), inp, val); parent.appendChild(f); updaters.push(upd); upd(); return f;
}
function row(parent, label, control) { const f = h('div', 'fld two'); f.append(h('label', null, label), control); parent.appendChild(f); return f; }
function selectBox(parent, label, options, get, set, relabel = false) {
  const s = h('select');
  for (const [v, n] of options) { const o = h('option', null, n); o.value = v; s.appendChild(o); }
  s.onchange = () => { set(s.value); touched(); commit(); if (relabel) emit('labels'); refresh(); };
  updaters.push(() => { s.value = get(); }); s.value = get();
  return row(parent, label, s);
}
function color(parent, label, get, set) {
  const i = h('input'); i.type = 'color'; i.value = get();
  i.oninput = () => { set(i.value); touched(); }; i.onchange = () => commit();
  updaters.push(() => { i.value = get(); });
  return row(parent, label, i);
}
function toggles(parent, label, items) {
  const seg = h('div', 'seg');
  for (const it of items) {
    const b = h('button', 'btn', it.label); if (it.title) b.title = it.title;
    const upd = () => b.classList.toggle('on', !!it.get());
    b.onclick = () => { it.set(!it.get()); touched(); commit(); emit('labels'); refresh(); };
    updaters.push(upd); upd(); seg.appendChild(b);
  }
  return row(parent, label, seg);
}
const pct = (v) => `${Math.round(v * 100)}%`;
const sec = (v) => `${(+v).toFixed(2)}s`;

export function refresh() { for (const u of updaters) u(); }

function build() {
  updaters = []; body.textContent = '';
  const c = selectedClip();
  if (!c) {
    body.appendChild(h('div', 'insp-empty', 'Wähle einen Clip aus, um ihn zu bearbeiten.'));
    const tip = h('div', 'hint'); tip.style.marginTop = '24px';
    tip.innerHTML = '<b>Tastenkürzel</b><br>Leertaste – Wiedergabe<br>S – Clip teilen<br>Entf – Löschen<br>Strg+D – Duplizieren<br>Strg+Z / Strg+Y – Rückgängig / Wiederholen<br>← → – Bild zurück / vor<br>Strg+Mausrad – Timeline zoomen';
    body.appendChild(tip); return;
  }
  const m = getMedia(c.mediaId);
  const names = { video: 'Video', image: 'Bild', audio: 'Audio', text: 'Text' };
  body.appendChild(h('div', 'clip-title', `${names[c.type]}: ${c.type === 'text' ? c.text.replace(/\n/g, ' ') : m?.name || ''}`));
  const visual = c.type !== 'audio';

  if (c.type === 'text') {
    const s = section('Text');
    const ta = h('textarea'); ta.value = c.text; ta.rows = 3;
    ta.oninput = () => { c.text = ta.value; touched(); }; ta.onchange = () => { commit(); emit('labels'); };
    updaters.push(() => { if (document.activeElement !== ta) ta.value = c.text; });
    s.appendChild(ta);
    selectBox(s, 'Schrift', FONTS.map((f) => [f, f]), () => c.font, (v) => { c.font = v; });
    slider(s, 'Größe', () => c.size, (v) => { c.size = v; }, 16, 400, 1, (v) => `${v}px`);
    color(s, 'Farbe', () => c.color, (v) => { c.color = v; });
    toggles(s, 'Stil', [
      { label: 'F', title: 'Fett', get: () => c.bold, set: (v) => { c.bold = v; } },
      { label: 'K', title: 'Kursiv', get: () => c.italic, set: (v) => { c.italic = v; } },
      { label: '⇤', title: 'Linksbündig', get: () => c.align === 'left', set: () => { c.align = 'left'; } },
      { label: '↔', title: 'Zentriert', get: () => c.align === 'center', set: () => { c.align = 'center'; } },
      { label: '⇥', title: 'Rechtsbündig', get: () => c.align === 'right', set: () => { c.align = 'right'; } },
    ]);
    color(s, 'Kontur', () => c.stroke, (v) => { c.stroke = v; });
    slider(s, 'Konturstärke', () => c.strokeWidth, (v) => { c.strokeWidth = v; }, 0, 30, 1, (v) => `${v}px`);
    color(s, 'Hintergrund', () => c.bgColor, (v) => { c.bgColor = v; });
    slider(s, 'Hintergr.-Deckkr.', () => c.bgOpacity, (v) => { c.bgOpacity = v; }, 0, 1, 0.05, pct);
    slider(s, 'Schatten', () => c.shadow, (v) => { c.shadow = v; }, 0, 1, 0.05, pct);
  }

  if (visual) {
    const s = section('Position & Größe', () => { Object.assign(c, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flip: false, kf: {} }); touched(); commit(); emit('labels'); refresh(); });
    const P = (n) => () => evalProp(c, n, localTime(c));
    const W = (n) => (v) => setProp(c, n, v);
    const kfLabels = () => { if (hasKf(c)) emit('labels'); };
    const tr = [
      slider(s, 'Größe', P('scale'), W('scale'), 0.05, 4, 0.01, pct),
      slider(s, 'Position X', P('x'), W('x'), -S.project.width, S.project.width, 1, (v) => Math.round(v)),
      slider(s, 'Position Y', P('y'), W('y'), -S.project.height, S.project.height, 1, (v) => Math.round(v)),
      slider(s, 'Drehung', P('rotation'), W('rotation'), -180, 180, 1, (v) => `${Math.round(v)}°`),
      slider(s, 'Deckkraft', P('opacity'), W('opacity'), 0, 1, 0.01, pct),
    ];
    for (const f of tr) f.querySelector('input').addEventListener('change', kfLabels);
    const kr = h('div', 'kf-row');
    const kb = h('button', 'btn'), kc = h('button', 'btn', 'Keyframes löschen');
    kb.title = 'Speichert Position, Größe, Drehung und Deckkraft an dieser Stelle. Zwischen zwei Keyframes wird die Bewegung automatisch berechnet.';
    kb.onclick = () => { toggleKeyframe(c); touched(); commit(); emit('labels'); refresh(); };
    kc.onclick = () => { clearKeyframes(c); touched(); commit(); emit('labels'); refresh(); };
    updaters.push(() => { const on = kfAt(c, localTime(c)); kb.textContent = on ? '◆ Keyframe entfernen' : '◇ Keyframe setzen'; kb.classList.toggle('on', on); kc.style.display = hasKf(c) ? '' : 'none'; });
    kr.append(kb, kc); s.appendChild(kr);
    selectBox(s, 'Mischmodus', [['source-over', 'Normal'], ['screen', 'Aufhellen (Screen)'], ['lighter', 'Addieren'], ['multiply', 'Multiplizieren'], ['overlay', 'Überlagern'], ['soft-light', 'Weiches Licht'], ['darken', 'Abdunkeln'], ['lighten', 'Heller'], ['difference', 'Differenz']], () => c.blend || 'source-over', (v) => { c.blend = v; });
    if (c.type !== 'text') {
      const fill = h('div', 'seg');
      const b1 = h('button', 'btn', 'Einpassen'), b2 = h('button', 'btn', 'Füllen'), b3 = h('button', 'btn', 'Spiegeln');
      b1.onclick = () => { setProp(c, 'scale', 1); setProp(c, 'x', 0); setProp(c, 'y', 0); touched(); commit(); refresh(); };
      b2.onclick = () => {
        const sw = m?.width || S.project.width, sh = m?.height || S.project.height;
        const fit = Math.min(S.project.width / sw, S.project.height / sh), cover = Math.max(S.project.width / sw, S.project.height / sh);
        setProp(c, 'scale', cover / fit); setProp(c, 'x', 0); setProp(c, 'y', 0); touched(); commit(); refresh();
      };
      b3.onclick = () => { c.flip = !c.flip; touched(); commit(); };
      fill.append(b1, b2, b3); row(s, 'Anpassen', fill);
    }
  }

  if (c.type === 'video' || c.type === 'image') {
    const s = section('Zuschnitt & Maske', () => { c.crop = { l: 0, r: 0, t: 0, b: 0 }; c.mask = 'none'; touched(); commit(); refresh(); });
    const cp = (v) => `${Math.round(v * 100)}%`;
    slider(s, 'Links', () => c.crop.l, (v) => { c.crop.l = Math.min(v, 0.95 - c.crop.r); }, 0, 0.9, 0.01, cp);
    slider(s, 'Rechts', () => c.crop.r, (v) => { c.crop.r = Math.min(v, 0.95 - c.crop.l); }, 0, 0.9, 0.01, cp);
    slider(s, 'Oben', () => c.crop.t, (v) => { c.crop.t = Math.min(v, 0.95 - c.crop.b); }, 0, 0.9, 0.01, cp);
    slider(s, 'Unten', () => c.crop.b, (v) => { c.crop.b = Math.min(v, 0.95 - c.crop.t); }, 0, 0.9, 0.01, cp);
    selectBox(s, 'Maske', [['none', 'Keine'], ['round', 'Abgerundet'], ['circle', 'Kreis / Oval'], ['square', 'Quadrat'], ['heart', 'Herz']], () => c.mask || 'none', (v) => { c.mask = v; });

    const g = section('Greenscreen');
    toggles(g, 'Farbe entfernen', [{ label: 'Ein', get: () => c.chroma.on, set: (v) => { c.chroma.on = v; } }]);
    color(g, 'Schlüsselfarbe', () => c.chroma.color, (v) => { c.chroma.color = v; });
    slider(g, 'Toleranz', () => c.chroma.tol, (v) => { c.chroma.tol = v; }, 0.05, 0.8, 0.01, pct);
    slider(g, 'Weiche Kante', () => c.chroma.soft, (v) => { c.chroma.soft = v; }, 0.01, 0.5, 0.01, pct);
  }

  {
    const s = section('Werkzeuge'); const grid = h('div', 'tool-grid');
    const tool = (label, fn, title) => { const b = h('button', 'btn', label); if (title) b.title = title; b.onclick = fn; grid.appendChild(b); };
    tool('✂ Teilen', splitAtPlayhead, 'Am Abspielkopf teilen (S)');
    tool('⧉ Duplizieren', duplicateSelected, 'Strg+D');
    tool('⇤ Löschen & Lücke schließen', rippleDelete, 'Umschalt+Entf');
    if (c.type === 'video') {
      tool('❄ Standbild', () => freezeFrame(), 'Friert das Bild am Abspielkopf für 2 Sekunden ein');
      tool('⏪ Rückwärts', reverseClip, 'Spielt den Clip rückwärts ab');
      if (m?.hasAudio) tool('♪ Ton abtrennen', detachAudio, 'Legt den Ton als eigenen Clip auf eine Audiospur');
    }
    if ((c.type === 'video' || c.type === 'audio') && m?.hasAudio) tool('⏭ Pausen entfernen', () => removeSilence(), 'Schneidet stille Stellen automatisch heraus');
    s.appendChild(grid);
  }

  if (c.type === 'video' || c.type === 'audio') {
    const s = section('Tempo & Ton');
    slider(s, 'Tempo', () => c.speed, (v) => {
      const srcDur = c.duration * c.speed; c.speed = v;
      const next = trackClips(c.trackId).find((x) => x.start >= clipEnd(c) - 1e-6 && x.id !== c.id);
      c.duration = clamp(srcDur / v, 0.1, Math.min(maxDuration(c), next ? next.start - c.start + 0 : Infinity));
    }, 0.25, 4, 0.05, (v) => `${(+v).toFixed(2)}x`, true);
    if (m?.hasAudio) {
      slider(s, 'Lautstärke', () => c.volume, (v) => { c.volume = v; }, 0, 2, 0.01, pct);
      slider(s, 'Einblenden', () => c.fadeIn, (v) => { c.fadeIn = v; }, 0, 5, 0.1, sec);
      slider(s, 'Ausblenden', () => c.fadeOut, (v) => { c.fadeOut = v; }, 0, 5, 0.1, sec);
      toggles(s, 'Ton', [{ label: 'Stumm', get: () => c.muted, set: (v) => { c.muted = v; } }]);
    } else s.appendChild(h('div', 'hint', 'Dieser Clip enthält keine Tonspur.'));
  }

  if (visual) {
    const f = c.filter;
    const s = section('Farbe', () => { c.filter = { ...FILTER_DEFAULT }; touched(); commit(); build(); emit('libstate'); });
    const p = FILTER_PRESETS.find((x) => x.id === f.preset);
    s.appendChild(h('div', 'hint', `Filter: ${p ? p.name : 'Original'}`));
    slider(s, 'Helligkeit', () => f.brightness, (v) => { f.brightness = v; }, 0, 200, 1, (v) => `${v}%`);
    slider(s, 'Kontrast', () => f.contrast, (v) => { f.contrast = v; }, 0, 200, 1, (v) => `${v}%`);
    slider(s, 'Sättigung', () => f.saturation, (v) => { f.saturation = v; }, 0, 200, 1, (v) => `${v}%`);
    slider(s, 'Farbton', () => f.hue, (v) => { f.hue = v; }, -180, 180, 1, (v) => `${v}°`);
    slider(s, 'Weichzeichner', () => f.blur, (v) => { f.blur = v; }, 0, 40, 0.5, (v) => `${v}px`);
    if (f.tint) slider(s, 'Tönung', () => f.tintAmt, (v) => { f.tintAmt = v; }, 0, 1, 0.05, pct);

    const active = FX_LIST.filter((x) => c.fx[x.id]);
    if (active.length) {
      const sf = section('FX-Stärke', () => { c.fx = {}; touched(); commit(); build(); emit('libstate'); emit('labels'); });
      for (const x of active) slider(sf, x.name, () => c.fx[x.id], (v) => { c.fx[x.id] = Math.max(0.05, v); }, 0.05, 1, 0.05, pct);
    }

    const sa = section('Animation');
    const ins = c.type === 'text' ? ANIMS_IN : ANIMS_IN.filter((a) => a[0] !== 'typewriter');
    selectBox(sa, 'Einblenden', ins, () => c.animIn.type, (v) => { c.animIn.type = v; emit('libstate'); });
    slider(sa, 'Dauer ein', () => c.animIn.dur, (v) => { c.animIn.dur = v; }, 0.1, 3, 0.1, sec);
    selectBox(sa, 'Ausblenden', ANIMS_OUT, () => c.animOut.type, (v) => { c.animOut.type = v; emit('libstate'); });
    slider(sa, 'Dauer aus', () => c.animOut.dur, (v) => { c.animOut.dur = v; }, 0.1, 3, 0.1, sec);
  }

  const st = section('Zeit');
  const info = h('div', 'hint');
  updaters.push(() => { info.textContent = `Start ${c.start.toFixed(2)}s · Dauer ${c.duration.toFixed(2)}s`; });
  st.appendChild(info);
  if (c.type === 'image' || c.type === 'text') {
    slider(st, 'Dauer', () => c.duration, (v) => {
      const next = trackClips(c.trackId).find((x) => x.start >= clipEnd(c) - 1e-6 && x.id !== c.id);
      c.duration = Math.min(v, next ? Math.max(0.1, next.start - c.start) : Infinity);
    }, 0.2, 30, 0.1, sec, true);
  }
  refresh();
}

on('selection', build);
on('project', build);
on('props', refresh);
on('time', () => { const c = selectedClip(); if (c && c.type !== 'audio' && hasKf(c)) refresh(); });
on('inspector', build);
build();
