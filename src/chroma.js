// Greenscreen (Chroma Key): macht eine Schlüsselfarbe transparent und entfernt den Farbsaum
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });
const cache = new WeakMap(); // Element -> { stamp, canvas }

const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export function chromaKey(el, sw, sh, o) {
  const stamp = `${el.currentTime ?? 0}|${el.currentSrc || el.src}|${o.color}|${o.tol}|${o.soft}`;
  let c = cache.get(el);
  if (c && c.stamp === stamp) return c.canvas;
  if (!c) { c = { stamp: '', canvas: document.createElement('canvas') }; cache.set(el, c); }
  try {
    const w = Math.min(sw, 1280), h = Math.max(2, Math.round((w * sh) / sw));
    if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
    wctx.drawImage(el, 0, 0, w, h);
    const img = wctx.getImageData(0, 0, w, h); const d = img.data;
    const [kr, kg, kb] = hexRgb(o.color);
    // Vergleich in der Farbebene (Cb/Cr), damit Helligkeitsunterschiede im Greenscreen egal sind
    const kcb = -0.169 * kr - 0.331 * kg + 0.5 * kb, kcr = 0.5 * kr - 0.419 * kg - 0.081 * kb;
    const t0 = o.tol * 180, t1 = t0 + Math.max(0.01, o.soft) * 180;
    const dom = kg >= kr && kg >= kb ? 1 : kb >= kr ? 2 : 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const cb = -0.169 * r - 0.331 * g + 0.5 * b, cr = 0.5 * r - 0.419 * g - 0.081 * b;
      const dist = Math.sqrt((cb - kcb) * (cb - kcb) + (cr - kcr) * (cr - kcr));
      if (dist <= t0) { d[i + 3] = 0; continue; }
      if (dist < t1) d[i + 3] = ((dist - t0) / (t1 - t0)) * 255;
      if (dist < t1 * 1.6) { // Farbsaum dämpfen
        if (dom === 1) { const m = (r + b) >> 1; if (g > m) d[i + 1] = m; }
        else if (dom === 2) { const m = (r + g) >> 1; if (b > m) d[i + 2] = m; }
        else { const m = (g + b) >> 1; if (r > m) d[i] = m; }
      }
    }
    const out = c.canvas;
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
    out.getContext('2d').putImageData(img, 0, 0);
    c.stamp = stamp;
    return out;
  } catch (e) {
    return null;
  }
}
