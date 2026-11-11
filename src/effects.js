// Filter-Presets, FX-Effekte und Animationen (alles in Canvas 2D, identisch für Vorschau und Export)
import { FILTER_DEFAULT } from './state.js';

export const FILTER_PRESETS = [
  { id: 'none', name: 'Original', v: {} },
  { id: 'vivid', name: 'Lebendig', v: { saturation: 145, contrast: 110 } },
  { id: 'warm', name: 'Warm', v: { saturation: 110, brightness: 103, tint: '#ff9a3c', tintAmt: 0.35 } },
  { id: 'cool', name: 'Kühl', v: { saturation: 95, tint: '#3c8cff', tintAmt: 0.35 } },
  { id: 'vintage', name: 'Vintage', v: { sepia: 35, contrast: 90, brightness: 106, saturation: 85, tint: '#e8c07a', tintAmt: 0.25 } },
  { id: 'bw', name: 'Schwarz-Weiß', v: { gray: 100, contrast: 118 } },
  { id: 'sepia', name: 'Sepia', v: { sepia: 85 } },
  { id: 'drama', name: 'Dramatisch', v: { contrast: 138, saturation: 80, brightness: 95 } },
  { id: 'fade', name: 'Verblasst', v: { contrast: 80, brightness: 110, saturation: 80 } },
  { id: 'cinema', name: 'Kino', v: { contrast: 115, saturation: 90, tint: '#1fa3a3', tintAmt: 0.3 } },
  { id: 'night', name: 'Nacht', v: { brightness: 80, saturation: 80, tint: '#2a3cff', tintAmt: 0.45 } },
  { id: 'pastel', name: 'Pastell', v: { saturation: 70, brightness: 112, contrast: 88 } },
  { id: 'neon', name: 'Neon', v: { saturation: 190, contrast: 122 } },
  { id: 'sunset', name: 'Sonnenuntergang', v: { saturation: 120, tint: '#ff5e3a', tintAmt: 0.4 } },
];

export function presetValues(id) {
  const p = FILTER_PRESETS.find((x) => x.id === id) || FILTER_PRESETS[0];
  return { ...FILTER_DEFAULT, tint: null, tintAmt: 0, ...p.v, preset: p.id };
}

export const FX_LIST = [
  { id: 'rgb', name: 'RGB-Split', icon: '◐' },
  { id: 'glitch', name: 'Glitch', icon: '▚' },
  { id: 'vhs', name: 'VHS', icon: '▤' },
  { id: 'pixel', name: 'Pixel', icon: '▦' },
  { id: 'vignette', name: 'Vignette', icon: '◉' },
  { id: 'grain', name: 'Filmkorn', icon: '░' },
  { id: 'glow', name: 'Glow', icon: '✺' },
  { id: 'mirror', name: 'Spiegel', icon: '◧' },
  { id: 'letterbox', name: 'Kino-Balken', icon: '▬' },
  { id: 'flash', name: 'Blitz', icon: '⚡' },
  { id: 'shake', name: 'Wackeln', icon: '≋' },
  { id: 'pulse', name: 'Zoom-Puls', icon: '◎' },
  { id: 'kenburns', name: 'Sanfter Zoom', icon: '⤢' },
  { id: 'rainbow', name: 'Regenbogen', icon: '◈' },
];

export const ANIMS_IN = [
  ['none', 'Keine'], ['fade', 'Einblenden'], ['slideL', 'Von links'], ['slideR', 'Von rechts'], ['slideU', 'Von oben'], ['slideD', 'Von unten'],
  ['zoomIn', 'Hereinzoomen'], ['zoomOut', 'Herauszoomen'], ['pop', 'Pop'], ['wipe', 'Wischen'], ['blur', 'Unschärfe'], ['spin', 'Drehen'], ['typewriter', 'Schreibmaschine'],
];
export const ANIMS_OUT = [
  ['none', 'Keine'], ['fade', 'Ausblenden'], ['slideL', 'Nach links'], ['slideR', 'Nach rechts'], ['slideU', 'Nach oben'], ['slideD', 'Nach unten'],
  ['zoomIn', 'Wegschrumpfen'], ['zoomOut', 'Wegzoomen'], ['wipe', 'Wischen'], ['blur', 'Unschärfe'], ['spin', 'Drehen'],
];

const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
export const rnd = (seed) => { const x = Math.sin(seed * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };

// Zustand der Ein-/Ausblend-Animation zu einem Zeitpunkt innerhalb des Clips
export function animState(clip, local, P) {
  const st = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, wipe: null, chars: null };
  const apply = (type, p, isIn) => {
    p = Math.min(1, Math.max(0, p));
    const e = easeOut(p), k = 1 - e;
    switch (type) {
      case 'fade': st.alpha *= p; break;
      case 'slideL': st.dx -= k * P.width; break;
      case 'slideR': st.dx += k * P.width; break;
      case 'slideU': st.dy -= k * P.height; break;
      case 'slideD': st.dy += k * P.height; break;
      case 'zoomIn': st.scale *= 0.55 + 0.45 * e; st.alpha *= Math.min(1, p * 2); break;
      case 'zoomOut': st.scale *= 1.5 - 0.5 * e; st.alpha *= Math.min(1, p * 2); break;
      case 'pop': st.scale *= Math.max(0.01, easeBack(p)); st.alpha *= Math.min(1, p * 3); break;
      case 'wipe': st.wipe = st.wipe == null ? { p: e, fromRight: !isIn } : st.wipe; break;
      case 'blur': st.blur += k * 40; st.alpha *= Math.min(1, p * 2); break;
      case 'spin': st.rot += k * (isIn ? -120 : 120); st.scale *= 0.3 + 0.7 * e; st.alpha *= Math.min(1, p * 2); break;
      case 'typewriter': st.chars = p; break;
      default: break;
    }
  };
  const ai = clip.animIn, ao = clip.animOut;
  if (ai && ai.type !== 'none' && ai.dur > 0 && local < ai.dur) apply(ai.type, local / ai.dur, true);
  if (ao && ao.type !== 'none' && ao.dur > 0 && clip.duration - local < ao.dur) apply(ao.type, (clip.duration - local) / ao.dur, false);
  return st;
}

// FX, die Position/Größe/Farbton verändern (vor dem Zeichnen)
export function fxTransform(clip, t, local) {
  const fx = clip.fx || {}; const o = { dx: 0, dy: 0, scale: 1, hue: 0 };
  if (fx.shake) {
    const a = fx.shake * 28, f = Math.floor(t * 24);
    o.dx += (rnd(f) - 0.5) * 2 * a; o.dy += (rnd(f + 99) - 0.5) * 2 * a; o.scale *= 1 + fx.shake * 0.05;
  }
  if (fx.pulse) o.scale *= 1 + fx.pulse * 0.12 * Math.pow(Math.abs(Math.sin(t * Math.PI * 2)), 6);
  if (fx.kenburns) o.scale *= 1 + fx.kenburns * 0.3 * Math.min(1, local / Math.max(0.1, clip.duration));
  if (fx.rainbow) o.hue += (t * 120 * fx.rainbow) % 360;
  return o;
}

export function filterString(f, s, extraBlur = 0, extraHue = 0) {
  const p = [];
  if (f.brightness !== 100) p.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) p.push(`contrast(${f.contrast}%)`);
  if (f.saturation !== 100) p.push(`saturate(${f.saturation}%)`);
  if (f.sepia) p.push(`sepia(${f.sepia}%)`);
  if (f.gray) p.push(`grayscale(${f.gray}%)`);
  const hue = (f.hue || 0) + extraHue;
  if (hue) p.push(`hue-rotate(${hue.toFixed(1)}deg)`);
  const blur = ((f.blur || 0) + extraBlur) * s;
  if (blur > 0.05) p.push(`blur(${blur.toFixed(2)}px)`);
  return p.length ? p.join(' ') : 'none';
}

let noiseCanvas = null;
function getNoise() {
  if (noiseCanvas) return noiseCanvas;
  noiseCanvas = document.createElement('canvas'); noiseCanvas.width = noiseCanvas.height = 256;
  const c = noiseCanvas.getContext('2d'); const d = c.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  c.putImageData(d, 0, 0);
  return noiseCanvas;
}

function swapInto(L, M) { // Inhalt von M nach L kopieren
  const c = L.getContext('2d');
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'copy'; c.globalAlpha = 1; c.filter = 'none';
  c.drawImage(M, 0, 0); c.restore();
}
function clear(cv) { const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.filter = 'none'; c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, cv.width, cv.height); return c; }

function rgbSplit(L, M, T, amount) {
  const m = clear(M); const chans = [['#ff0000', -amount], ['#00ff00', 0], ['#0000ff', amount]];
  for (const [col, off] of chans) {
    const t = clear(T);
    t.drawImage(L, 0, 0);
    t.globalCompositeOperation = 'multiply'; t.fillStyle = col; t.fillRect(0, 0, T.width, T.height);
    t.globalCompositeOperation = 'destination-in'; t.drawImage(L, 0, 0);
    m.globalCompositeOperation = 'lighter'; m.drawImage(T, off, 0);
  }
  swapInto(L, M);
}

// Nachbearbeitungs-FX auf der fertig gezeichneten Clip-Ebene L (M und T sind Hilfsflächen gleicher Größe)
export function applyPostFx(clip, t, L, M, T, s) {
  const fx = clip.fx || {}; const W = L.width, H = L.height;
  const l = L.getContext('2d');
  const reset = () => { l.setTransform(1, 0, 0, 1, 0, 0); l.globalAlpha = 1; l.filter = 'none'; l.globalCompositeOperation = 'source-over'; };
  reset();

  if (fx.mirror) {
    const m = clear(M); const half = Math.floor(W / 2);
    m.drawImage(L, 0, 0, half, H, 0, 0, half, H);
    m.save(); m.translate(W, 0); m.scale(-1, 1); m.drawImage(L, 0, 0, half, H, 0, 0, half, H); m.restore();
    swapInto(L, M);
  }
  if (fx.pixel) {
    const k = Math.max(2, Math.round((4 + fx.pixel * 36) * s));
    const sw = Math.max(1, Math.round(W / k)), sh = Math.max(1, Math.round(H / k));
    const t2 = clear(T); t2.imageSmoothingEnabled = true; t2.drawImage(L, 0, 0, W, H, 0, 0, sw, sh);
    const m = clear(M); m.imageSmoothingEnabled = false; m.drawImage(T, 0, 0, sw, sh, 0, 0, W, H); m.imageSmoothingEnabled = true;
    swapInto(L, M);
  }
  if (fx.glow) {
    const m = clear(M); m.filter = `blur(${(6 + fx.glow * 18) * s}px) brightness(115%)`; m.drawImage(L, 0, 0); m.filter = 'none';
    m.globalCompositeOperation = 'destination-in'; m.drawImage(L, 0, 0);
    reset(); l.globalCompositeOperation = 'screen'; l.globalAlpha = 0.35 + fx.glow * 0.5; l.drawImage(M, 0, 0); reset();
  }
  if (fx.rgb) rgbSplit(L, M, T, Math.max(1, fx.rgb * 26 * s));
  if (fx.vhs) {
    rgbSplit(L, M, T, Math.max(1, (2 + fx.vhs * 7) * s));
    reset(); l.globalCompositeOperation = 'source-atop';
    l.fillStyle = `rgba(0,0,0,${0.12 + fx.vhs * 0.22})`;
    const step = Math.max(2, Math.round(4 * s));
    for (let y = 0; y < H; y += step) l.fillRect(0, y, W, Math.max(1, step / 2));
    const by = ((t * 0.35) % 1) * H; // wandernder Störstreifen
    l.fillStyle = `rgba(255,255,255,${0.05 + fx.vhs * 0.08})`; l.fillRect(0, by, W, H * 0.06);
    reset();
  }
  if (fx.glitch) {
    const tick = Math.floor(t * 14);
    if (rnd(tick * 0.37) < 0.25 + fx.glitch * 0.5) {
      const m = clear(M); m.drawImage(L, 0, 0);
      const n = 3 + Math.floor(rnd(tick) * 6);
      for (let i = 0; i < n; i++) {
        const y = Math.floor(rnd(tick + i * 7.1) * H), h = Math.max(2, Math.floor(rnd(tick + i * 3.3) * H * 0.12));
        const dx = (rnd(tick + i * 1.7) - 0.5) * 2 * fx.glitch * 160 * s;
        m.clearRect(0, y, W, h); m.drawImage(L, 0, y, W, h, dx, y, W, h);
      }
      swapInto(L, M);
      rgbSplit(L, M, T, Math.max(1, fx.glitch * 14 * s * (0.4 + rnd(tick + 5))));
    }
  }
  if (fx.grain) {
    const nz = getNoise(); reset();
    l.globalCompositeOperation = 'source-atop'; l.globalAlpha = 0.06 + fx.grain * 0.3;
    const f = Math.floor(t * 30), ox = Math.floor(rnd(f) * 256), oy = Math.floor(rnd(f + 31) * 256);
    const sc = Math.max(1, Math.round(2 * s * 1.5));
    l.save(); l.imageSmoothingEnabled = false; l.translate(-ox * sc, -oy * sc); l.scale(sc, sc);
    l.fillStyle = l.createPattern(nz, 'repeat'); l.fillRect(0, 0, W / sc + 256, H / sc + 256); l.restore();
    l.imageSmoothingEnabled = true; reset();
  }
  if (fx.vignette) {
    reset(); l.globalCompositeOperation = 'source-atop';
    const g = l.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.55 - fx.vignette * 0.3), W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.35 + fx.vignette * 0.6})`);
    l.fillStyle = g; l.fillRect(0, 0, W, H); reset();
  }
  if (fx.flash) {
    const a = Math.pow(Math.abs(Math.sin(t * Math.PI * 2)), 10) * (0.3 + fx.flash * 0.7);
    if (a > 0.01) { reset(); l.globalCompositeOperation = 'source-atop'; l.fillStyle = `rgba(255,255,255,${a})`; l.fillRect(0, 0, W, H); reset(); }
  }
  if (fx.letterbox) {
    reset(); const bar = H * (0.05 + fx.letterbox * 0.1);
    l.fillStyle = '#000'; l.fillRect(0, 0, W, bar); l.fillRect(0, H - bar, W, bar);
  }
  reset();
}

export const hasPostFx = (clip) => {
  const fx = clip.fx || {};
  return ['mirror', 'pixel', 'glow', 'rgb', 'vhs', 'glitch', 'grain', 'vignette', 'flash', 'letterbox'].some((k) => fx[k]);
};
