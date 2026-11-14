// KI-Hintergrundentfernung: Personen-Segmentierung mit MediaPipe (läuft komplett lokal, Modell liegt der App bei)
const BASE = 'app://klipwerk/node_modules/@mediapipe/tasks-vision';
const MODEL = 'app://klipwerk/assets/models/selfie_segmenter.tflite';

const inCanvas = document.createElement('canvas');
const inCtx = inCanvas.getContext('2d', { willReadFrequently: true });
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');
const cache = new WeakMap(); // Element -> { stamp, canvas }
let seg = null;

export const segmenter = {
  state: 'idle', error: null, onReady: null, onState: null,

  async load() {
    if (this.state === 'loading' || this.state === 'ready') return;
    this.state = 'loading'; this.onState?.();
    try {
      const { FilesetResolver, ImageSegmenter } = await import(`${BASE}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
      const make = (delegate) => ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
      });
      try { seg = await make('GPU'); } catch (e) { console.warn('GPU-Segmentierung nicht verfügbar, nutze CPU', e); seg = await make('CPU'); }
      this.state = 'ready';
    } catch (e) {
      console.error(e); this.state = 'error'; this.error = String(e?.message || e);
    }
    this.onState?.(); this.onReady?.();
  },

  // Schwerpunkt der erkannten Person (0..1) – für das automatische Zentrieren
  locate(el, sw, sh) {
    if (this.state !== 'ready') return null;
    const inW = 256, inH = Math.max(16, Math.round((256 * sh) / sw));
    if (inCanvas.width !== inW || inCanvas.height !== inH) { inCanvas.width = inW; inCanvas.height = inH; }
    inCtx.drawImage(el, 0, 0, inW, inH);
    const res = seg.segment(inCanvas); const mask = res.confidenceMasks[res.confidenceMasks.length - 1];
    const data = mask.getAsFloat32Array(); const mw = mask.width, mh = mask.height;
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { const v = data[y * mw + x]; if (v > 0.5) { sx += x; sy += y; n++; } }
    res.close?.();
    if (n < mw * mh * 0.01) return null;
    return { x: sx / n / mw, y: sy / n / mh, area: n / (mw * mh) };
  },

  // Liefert eine Canvas mit freigestellter Person (oder null, solange das Modell lädt)
  cutout(el, sw, sh, invert) {
    if (this.state !== 'ready') { if (this.state === 'idle') this.load(); return null; }
    const stamp = `${el.currentTime ?? 0}|${el.currentSrc || el.src}|${invert ? 1 : 0}`;
    let c = cache.get(el);
    if (c && c.stamp === stamp) return c.canvas;
    if (!c) { c = { stamp: '', canvas: document.createElement('canvas') }; cache.set(el, c); }
    try {
      const inW = 256, inH = Math.max(16, Math.round((256 * sh) / sw));
      if (inCanvas.width !== inW || inCanvas.height !== inH) { inCanvas.width = inW; inCanvas.height = inH; }
      inCtx.drawImage(el, 0, 0, inW, inH);
      const res = seg.segment(inCanvas);
      const masks = res.confidenceMasks;
      const mask = masks[masks.length - 1];
      const data = mask.getAsFloat32Array(); const mw = mask.width, mh = mask.height;
      if (maskCanvas.width !== mw || maskCanvas.height !== mh) { maskCanvas.width = mw; maskCanvas.height = mh; }
      const img = maskCtx.createImageData(mw, mh); const px = img.data;
      const flip = invert;
      for (let i = 0, j = 3; i < data.length; i++, j += 4) {
        let v = flip ? 1 - data[i] : data[i];
        v = (v - 0.3) / 0.4; v = v < 0 ? 0 : v > 1 ? 1 : v;
        px[j] = v * v * (3 - 2 * v) * 255;
      }
      maskCtx.putImageData(img, 0, 0);
      res.close?.();
      const ow = Math.min(sw, 1280), oh = Math.round((ow * sh) / sw);
      const out = c.canvas;
      if (out.width !== ow || out.height !== oh) { out.width = ow; out.height = oh; }
      const o = out.getContext('2d');
      o.globalCompositeOperation = 'copy'; o.filter = 'none'; o.drawImage(el, 0, 0, ow, oh);
      const blur = Math.max(1, ow / 256 * 0.9), pad = blur * 3;
      o.globalCompositeOperation = 'destination-in'; o.filter = `blur(${blur.toFixed(1)}px)`;
      o.drawImage(maskCanvas, -pad, -pad, ow + pad * 2, oh + pad * 2);
      o.filter = 'none'; o.globalCompositeOperation = 'source-over';
      c.stamp = stamp;
      return out;
    } catch (e) {
      if (!this._warned) { this._warned = true; console.error('Segmentierung fehlgeschlagen', e); }
      return null;
    }
  },
};
