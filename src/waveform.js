// Wellenformen für die Timeline (werden einmal je Datei berechnet und zwischengespeichert)
const cache = new Map(); // Pfad -> Promise<Uint8Array>
export const PEAKS_PER_SEC = 50;

export function getPeaks(path) {
  if (!cache.has(path)) cache.set(path, window.api.peaks(path).then((p) => new Uint8Array(p)).catch(() => new Uint8Array(0)));
  return cache.get(path);
}

export function drawWave(canvas, peaks, srcStart, srcDur, color = 'rgba(255,255,255,.75)') {
  const w = canvas.width, h = canvas.height, c = canvas.getContext('2d');
  c.clearRect(0, 0, w, h); c.fillStyle = color;
  if (!peaks.length || srcDur <= 0) return;
  const i0 = srcStart * PEAKS_PER_SEC, span = srcDur * PEAKS_PER_SEC;
  for (let x = 0; x < w; x++) {
    const a = Math.floor(i0 + (x / w) * span), b = Math.max(a + 1, Math.floor(i0 + ((x + 1) / w) * span));
    let m = 0; for (let i = a; i < b && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
    const bar = Math.max(1, (m / 255) * h);
    c.fillRect(x, (h - bar) / 2, 1, bar);
  }
}
