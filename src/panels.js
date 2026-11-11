// Linke Bibliothek: Medien, Textstile, Filter, FX, Animationen und KI-Werkzeuge
import { S, on, emit, uid, getMedia, selectedClip, commit, changed, touched, mediaUrl, toast, fmtTime } from './state.js';
import { FILTER_PRESETS, presetValues, FX_LIST, ANIMS_IN, ANIMS_OUT, filterString } from './effects.js';
import { addMedia, addText } from './timeline.js';
import { segmenter } from './ai/segmenter.js';
import { generateCaptions } from './ai/captions.js';

const api = window.api;
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const visualSel = () => { const c = selectedClip(); return c && c.type !== 'audio' ? c : null; };
const needVisual = () => { const c = visualSel(); if (!c) toast('Wähle zuerst einen Video-, Bild- oder Textclip in der Timeline aus.'); return c; };

// ---------- Tabs ----------
document.querySelectorAll('#tabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === b.dataset.tab));
  };
});

// ---------- Medien ----------
const IMG = /\.(png|jpe?g|webp|gif|bmp)$/i;
const AUD = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const grid = document.getElementById('mediaGrid');

function loadEl(tag, url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag); el.preload = 'auto'; el.muted = true;
    const to = setTimeout(() => reject(new Error('Zeitüberschreitung')), timeout);
    el.addEventListener('loadeddata', () => { clearTimeout(to); resolve(el); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(to); reject(new Error('nicht abspielbar')); }, { once: true });
    el.src = url;
  });
}
function thumbOf(src, w, hh) {
  const c = document.createElement('canvas'); c.width = 160; c.height = Math.max(40, Math.round((160 * hh) / w));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
async function videoThumb(el) {
  const t = Math.min(1, (el.duration || 1) * 0.1);
  await new Promise((r) => { const to = setTimeout(r, 4000); el.addEventListener('seeked', () => { clearTimeout(to); r(); }, { once: true }); el.currentTime = t; });
  return thumbOf(el, el.videoWidth, el.videoHeight);
}
const release = (el) => { try { el.removeAttribute('src'); el.load(); } catch {} };

export async function importPaths(paths) {
  let first = null;
  for (const p of paths) {
    const name = p.split(/[\\/]/).pop();
    try {
      let media;
      if (IMG.test(name)) {
        const img = new Image(); img.src = mediaUrl(p); await img.decode();
        media = { id: uid('m'), type: 'image', path: p, origPath: p, name, duration: 5, width: img.naturalWidth, height: img.naturalHeight, hasAudio: false, thumb: thumbOf(img, img.naturalWidth, img.naturalHeight) };
      } else {
        const probe = await api.probe(p);
        if (!probe.duration || (!probe.hasVideo && !probe.hasAudio)) throw new Error('Format wird nicht erkannt');
        const isVideo = probe.hasVideo && !AUD.test(name);
        let path = p, el;
        try {
          el = await loadEl(isVideo ? 'video' : 'audio', mediaUrl(p));
          if (isVideo && !el.videoWidth) throw new Error('Codec nicht unterstützt');
        } catch {
          toast(`„${name}“ wird in ein bearbeitbares Format umgewandelt …`, 'info', 6000);
          path = await api.transcode(p);
          el = await loadEl(isVideo ? 'video' : 'audio', mediaUrl(path), 30000);
        }
        const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : probe.duration;
        media = { id: uid('m'), type: isVideo ? 'video' : 'audio', path, origPath: p, name, duration, width: isVideo ? el.videoWidth : 0, height: isVideo ? el.videoHeight : 0, hasAudio: probe.hasAudio, thumb: isVideo ? await videoThumb(el) : null };
        release(el);
      }
      S.project.media.push(media); S.dirty = true; first ||= media;
      renderMedia();
    } catch (e) {
      console.error(e); toast(`„${name}“ konnte nicht importiert werden: ${e.message}`, 'error', 6000);
    }
  }
  return first;
}

export function renderMedia() {
  grid.textContent = '';
  for (const m of S.project.media) {
    const it = h('div', 'media-item'); it.draggable = true; it.title = m.origPath || m.path;
    const th = h('div', 'thumb'); if (m.thumb) th.style.backgroundImage = `url("${m.thumb}")`; else th.textContent = '♪';
    const add = h('button', 'add', '+'); add.title = 'An der Abspielposition einfügen'; add.onclick = (e) => { e.stopPropagation(); addMedia(m); };
    const rm = h('button', 'rm', '✕'); rm.title = 'Aus dem Projekt entfernen';
    rm.onclick = (e) => {
      e.stopPropagation();
      if (S.project.clips.some((c) => c.mediaId === m.id)) { toast('Diese Datei wird noch in der Timeline verwendet.'); return; }
      S.project.media = S.project.media.filter((x) => x.id !== m.id); S.dirty = true; renderMedia();
    };
    it.append(th, add, rm, h('div', 'name', m.name));
    if (m.type !== 'image') it.appendChild(h('div', 'dur', fmtTime(m.duration).slice(0, 5)));
    it.ondblclick = () => addMedia(m);
    it.ondragstart = (e) => { e.dataTransfer.setData('application/x-klipwerk-media', m.id); e.dataTransfer.effectAllowed = 'copy'; };
    grid.appendChild(it);
  }
  document.getElementById('emptyHint').classList.toggle('hidden', S.project.clips.length > 0);
}
document.getElementById('btnImport').onclick = async () => { const p = await api.openMedia(); if (p.length) importPaths(p); };

// Dateien von außen in das Fenster ziehen
const veil = document.getElementById('dropVeil'); let depth = 0;
const isFiles = (e) => e.dataTransfer?.types?.includes('Files');
window.addEventListener('dragenter', (e) => { if (isFiles(e)) { depth++; veil.classList.remove('hidden'); } });
window.addEventListener('dragleave', (e) => { if (isFiles(e) && --depth <= 0) { depth = 0; veil.classList.add('hidden'); } });
window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!isFiles(e)) return;
  e.preventDefault(); depth = 0; veil.classList.add('hidden');
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  if (paths.length) importPaths(paths);
});

// ---------- Textstile ----------
const TEXT_STYLES = [
  { name: 'Titel', css: 'font-weight:700', style: { text: 'Titel', size: 140, bold: true, shadow: 0.6 } },
  { name: 'Untertitel', css: 'font-weight:700;-webkit-text-stroke:1px #000', style: { text: 'Untertitel', size: 64, strokeWidth: 6, y: 380 } },
  { name: 'Bauchbinde', css: 'background:#7c5cff;padding:2px 6px;border-radius:4px', style: { text: 'Name · Rolle', size: 56, bgColor: '#7c5cff', bgOpacity: 1, shadow: 0, x: -520, y: 380, animIn: { type: 'slideL', dur: 0.5 } } },
  { name: 'Neon', css: 'color:#39ffb6;text-shadow:0 0 8px #39ffb6', style: { text: 'NEON', size: 150, color: '#39ffb6', font: 'Bahnschrift', fx: { glow: 0.8 } } },
  { name: 'Impact', css: 'font-family:Impact;color:#ffe14d', style: { text: 'WOW!', size: 190, font: 'Impact', color: '#ffe14d', strokeWidth: 10, animIn: { type: 'pop', dur: 0.4 } } },
  { name: 'Schreibmaschine', css: 'font-family:Consolas', style: { text: 'Es war einmal …', size: 72, font: 'Courier New', bold: false, animIn: { type: 'typewriter', dur: 1.5 } } },
  { name: 'Zitat', css: 'font-family:Georgia;font-style:italic', style: { text: '„Ein schönes Zitat.“', size: 84, font: 'Georgia', italic: true, bold: false } },
  { name: 'Glitch', css: 'color:#fff;text-shadow:2px 0 #f0f,-2px 0 #0ff', style: { text: 'GLITCH', size: 160, font: 'Bahnschrift', fx: { glitch: 0.6, rgb: 0.3 } } },
  { name: 'Kasten', css: 'background:#fff;color:#000;padding:2px 6px', style: { text: 'Hinweis', size: 72, color: '#000000', bgColor: '#ffffff', bgOpacity: 1, shadow: 0 } },
];
const textGrid = document.getElementById('textGrid');
for (const t of TEXT_STYLES) {
  const b = h('button', 'tile'); const sw = h('div', 'sw txt'); const sp = h('span', null, 'Abc'); sp.style.cssText = t.css; sw.appendChild(sp);
  b.append(sw, h('div', 'lbl', t.name));
  b.onclick = () => {
    const k = Math.min(S.project.width, S.project.height) / 1080; const st = JSON.parse(JSON.stringify(t.style));
    st.size = Math.round(st.size * k); if (st.x) st.x = Math.round(st.x * (S.project.width / 1920)); if (st.y) st.y = Math.round(st.y * (S.project.height / 1080));
    if (st.strokeWidth) st.strokeWidth = Math.max(2, Math.round(st.strokeWidth * k));
    addText(st);
  };
  textGrid.appendChild(b);
}

// ---------- Filter / FX / Animationen ----------
const filterGrid = document.getElementById('filterGrid');
for (const p of FILTER_PRESETS) {
  const b = h('button', 'tile'); b.dataset.id = p.id; const sw = h('div', 'sw');
  const v = presetValues(p.id); sw.style.filter = filterString(v, 1);
  if (v.tint) sw.style.boxShadow = `inset 0 0 0 100px ${v.tint}${Math.round(v.tintAmt * 110).toString(16).padStart(2, '0')}`;
  b.append(sw, h('div', 'lbl', p.name));
  b.onclick = () => { const c = needVisual(); if (!c) return; c.filter = presetValues(p.id); touched(); commit(); emit('inspector'); emit('labels'); syncLib(); };
  filterGrid.appendChild(b);
}
const fxGrid = document.getElementById('fxGrid');
for (const f of FX_LIST) {
  const b = h('button', 'tile'); b.dataset.id = f.id; b.append(h('div', 'sw fx', f.icon), h('div', 'lbl', f.name));
  b.onclick = () => {
    const c = needVisual(); if (!c) return;
    if (c.fx[f.id]) delete c.fx[f.id]; else c.fx[f.id] = 0.5;
    touched(); commit(); emit('inspector'); emit('labels'); syncLib();
  };
  fxGrid.appendChild(b);
}
function animGrid(host, list, key) {
  for (const [id, name] of list) {
    const b = h('button', 'chip', name); b.dataset.id = id;
    b.onclick = () => {
      const c = needVisual(); if (!c) return;
      if (id === 'typewriter' && c.type !== 'text') { toast('Die Schreibmaschine gibt es nur für Text.'); return; }
      c[key].type = id; touched(); commit(); emit('inspector'); syncLib();
    };
    host.appendChild(b);
  }
}
animGrid(document.getElementById('animInGrid'), ANIMS_IN, 'animIn');
animGrid(document.getElementById('animOutGrid'), ANIMS_OUT, 'animOut');

function syncLib() {
  const c = visualSel();
  document.querySelectorAll('.need-visual').forEach((e) => e.classList.toggle('hidden', !!c));
  filterGrid.querySelectorAll('.tile').forEach((b) => b.classList.toggle('active', !!c && c.filter.preset === b.dataset.id));
  fxGrid.querySelectorAll('.tile').forEach((b) => b.classList.toggle('active', !!c && !!c.fx[b.dataset.id]));
  document.querySelectorAll('#animInGrid .chip').forEach((b) => b.classList.toggle('active', !!c && c.animIn.type === b.dataset.id));
  document.querySelectorAll('#animOutGrid .chip').forEach((b) => b.classList.toggle('active', !!c && c.animOut.type === b.dataset.id));
  syncAi();
}

// ---------- KI ----------
const ai = document.getElementById('aiPanel');
function card(title, badge, desc) {
  const c = h('div', 'ai-card'); const hd = h('h4', null, title); hd.appendChild(h('span', 'badge', badge));
  c.append(hd, h('p', null, desc)); ai.appendChild(c);
  const status = h('div', 'status'); const bar = h('div', 'bar hidden'); bar.appendChild(h('div'));
  c.setStatus = (msg, p, err) => {
    status.textContent = msg || ''; status.classList.toggle('err', !!err);
    bar.classList.toggle('hidden', p == null || p >= 1); if (p != null) bar.firstChild.style.width = `${Math.round(p * 100)}%`;
  };
  c.finish = () => c.append(status, bar);
  return c;
}
const rowOf = (...els) => { const r = h('div', 'row'); r.append(...els); return r; };
const sel = (opts, val) => { const s = h('select'); for (const [v, n] of opts) { const o = h('option', null, n); o.value = v; s.appendChild(o); } if (val) s.value = val; return s; };

// Auto-Untertitel
const capCard = card('Auto-Untertitel', 'lokal', 'Erkennt gesprochene Sprache in der Timeline und fügt gestylte Untertitel ein.');
const capModel = sel([['Xenova/whisper-tiny', 'Schnell (ca. 40 MB)'], ['Xenova/whisper-base', 'Ausgewogen (ca. 80 MB)'], ['Xenova/whisper-small', 'Genau (ca. 250 MB)']], 'Xenova/whisper-base');
const capLang = sel([['german', 'Deutsch'], ['english', 'Englisch'], ['french', 'Französisch'], ['spanish', 'Spanisch'], ['italian', 'Italienisch'], ['turkish', 'Türkisch'], ['polish', 'Polnisch'], ['russian', 'Russisch'], ['arabic', 'Arabisch'], ['portuguese', 'Portugiesisch'], ['dutch', 'Niederländisch'], ['ukrainian', 'Ukrainisch']]);
const capBtn = h('button', 'btn primary wide', 'Untertitel erzeugen');
capCard.append(rowOf(h('span', 'dim', 'Sprache'), capLang), rowOf(h('span', 'dim', 'Modell'), capModel), capBtn); capCard.finish();
capBtn.onclick = async () => {
  capBtn.disabled = true;
  try { await generateCaptions({ model: capModel.value, language: capLang.value, onStatus: (m, p) => capCard.setStatus(m, p) }); toast('Untertitel wurden eingefügt.', 'ok'); }
  catch (e) {
    console.error(e);
    const net = /fetch|network|Failed to load|ERR_/i.test(e.message);
    capCard.setStatus(net ? 'Das Sprachmodell konnte nicht geladen werden. Beim ersten Mal ist eine Internetverbindung nötig.' : e.message, null, true);
  }
  capBtn.disabled = false;
};

// Hintergrund entfernen
const bgCard = card('Hintergrund entfernen', 'lokal', 'Stellt Personen automatisch frei – ohne Greenscreen. Für den ausgewählten Video- oder Bildclip.');
const bgBtn = h('button', 'btn wide', 'Einschalten');
const bgMode = sel([['transparent', 'Hintergrund transparent'], ['blur', 'Hintergrund weichzeichnen'], ['color', 'Hintergrund einfärben']]);
const bgColor = h('input'); bgColor.type = 'color';
const bgInv = h('button', 'btn', 'Maske umkehren');
bgCard.append(bgBtn, rowOf(bgMode, bgColor), bgInv); bgCard.finish();
const bgClip = () => { const c = selectedClip(); return c && (c.type === 'video' || c.type === 'image') ? c : null; };
const bgChanged = () => { touched(); commit(); emit('labels'); syncAi(); };
bgBtn.onclick = () => {
  const c = bgClip(); if (!c) { toast('Wähle zuerst einen Video- oder Bildclip aus.'); return; }
  c.bg.remove = !c.bg.remove; if (c.bg.remove) segmenter.load(); bgChanged();
};
bgMode.onchange = () => { const c = bgClip(); if (c) { c.bg.mode = bgMode.value; bgChanged(); } };
bgColor.oninput = () => { const c = bgClip(); if (c) { c.bg.color = bgColor.value; touched(); } };
bgColor.onchange = () => commit();
bgInv.onclick = () => { const c = bgClip(); if (c) { c.bg.invert = !c.bg.invert; bgChanged(); } };
segmenter.onState = () => syncAi();

// Text-zu-Sprache
const ttsCard = card('Text-zu-Sprache', 'lokal', 'Wandelt Text mit den in Windows installierten Stimmen in eine Sprecherspur um.');
const ttsText = h('textarea'); ttsText.placeholder = 'Text eingeben …'; ttsText.rows = 3;
const ttsVoice = sel([['', 'Standardstimme']]);
const ttsRate = h('input'); ttsRate.type = 'range'; ttsRate.min = -5; ttsRate.max = 5; ttsRate.value = 0; ttsRate.title = 'Sprechtempo';
const ttsBtn = h('button', 'btn primary wide', 'Sprache erzeugen & einfügen');
ttsCard.append(ttsText, rowOf(h('span', 'dim', 'Stimme'), ttsVoice), rowOf(h('span', 'dim', 'Tempo'), ttsRate), ttsBtn); ttsCard.finish();
api.ttsVoices().then((r) => {
  for (const v of r.voices) { const o = h('option', null, `${v.name} (${v.lang})`); o.value = v.name; ttsVoice.appendChild(o); }
  const de = r.voices.find((v) => /^de/i.test(v.lang)); if (de) ttsVoice.value = de.name;
  if (r.error || !r.voices.length) ttsCard.setStatus(r.error || 'Keine Stimmen gefunden. Stimmen lassen sich in den Windows-Einstellungen unter „Zeit und Sprache → Sprachausgabe“ hinzufügen.', null, true);
}).catch(() => {});
ttsBtn.onclick = async () => {
  const text = ttsText.value.trim(); if (!text) { toast('Bitte zuerst einen Text eingeben.'); return; }
  ttsBtn.disabled = true; ttsCard.setStatus('Sprache wird erzeugt …');
  try {
    const path = await api.ttsSpeak({ text, voice: ttsVoice.value, rate: +ttsRate.value });
    const before = S.project.media.length; const m = await importPaths([path]);
    if (!m || S.project.media.length === before) throw new Error('Die erzeugte Datei konnte nicht geladen werden.');
    m.name = `Sprache: ${text.slice(0, 24)}${text.length > 24 ? '…' : ''}`; renderMedia();
    addMedia(m); ttsCard.setStatus('Sprecherspur eingefügt.');
  } catch (e) { console.error(e); ttsCard.setStatus(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), null, true); }
  ttsBtn.disabled = false;
};

// Audio verbessern
const enhCard = card('Audio verbessern', 'lokal', 'Entfernt Rauschen und Brummen und gleicht die Lautstärke von Sprachaufnahmen an. Für den ausgewählten Clip.');
const enhBtn = h('button', 'btn wide', 'Einschalten');
enhCard.append(enhBtn); enhCard.finish();
const enhClip = () => { const c = selectedClip(); return c && (c.type === 'video' || c.type === 'audio') && getMedia(c.mediaId)?.hasAudio ? c : null; };
enhBtn.onclick = async () => {
  const c = enhClip(); if (!c) { toast('Wähle zuerst einen Clip mit Ton aus.'); return; }
  if (c.enhance) { c.enhance = false; touched(); commit(); emit('labels'); syncAi(); return; }
  enhBtn.disabled = true; enhCard.setStatus('Ton wird analysiert und bereinigt …');
  try {
    c.enhancedPath = await api.enhanceAudio(getMedia(c.mediaId).path); c.enhance = true;
    touched(); commit(); emit('labels'); enhCard.setStatus('Verbesserter Ton ist aktiv.');
  } catch (e) { console.error(e); enhCard.setStatus(e.message, null, true); }
  enhBtn.disabled = false; syncAi();
};

function syncAi() {
  const b = bgClip();
  bgBtn.textContent = b?.bg.remove ? 'Ausschalten' : 'Einschalten'; bgBtn.classList.toggle('primary', !!b?.bg.remove);
  if (b) { bgMode.value = b.bg.mode; bgColor.value = b.bg.color; }
  bgColor.style.visibility = b?.bg.mode === 'color' ? 'visible' : 'hidden';
  bgInv.classList.toggle('hidden', !b?.bg.remove);
  if (b?.bg.remove) {
    bgCard.setStatus(segmenter.state === 'loading' ? 'KI-Modell wird geladen …' : segmenter.state === 'error' ? `Modell konnte nicht geladen werden: ${segmenter.error}` : 'Aktiv – wird auch beim Export angewendet.', null, segmenter.state === 'error');
  } else bgCard.setStatus('');
  const e = enhClip();
  enhBtn.textContent = e?.enhance ? 'Ausschalten' : 'Einschalten'; enhBtn.classList.toggle('primary', !!e?.enhance);
  if (!e?.enhance && !enhBtn.disabled) enhCard.setStatus('');
}

on('selection', syncLib);
on('project', () => { syncLib(); renderMedia(); });
on('libstate', syncLib);
syncLib();
