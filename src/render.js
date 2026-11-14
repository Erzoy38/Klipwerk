// Compositor: zeichnet ein Bild der Timeline auf eine Canvas (Vorschau und Export nutzen denselben Code)
import { S, getMedia, getTrack, evalProp } from './state.js';
import { chromaKey } from './chroma.js';
import { animState, fxTransform, filterString, applyPostFx, hasPostFx } from './effects.js';

const scratch = new Map();
function getScratch(w, h) {
  const key = `${w}x${h}`;
  let s = scratch.get(key);
  if (!s) {
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    s = { L: mk(), M: mk(), T: mk() };
    if (scratch.size > 3) scratch.clear();
    scratch.set(key, s);
  }
  return s;
}

const measureCtx = document.createElement('canvas').getContext('2d');
const fontOf = (c) => `${c.italic ? 'italic ' : ''}${c.bold ? '700 ' : '400 '}${c.size}px "${c.font}", "Segoe UI", Arial, sans-serif`;

export function layoutText(clip, P) {
  const ctx = measureCtx; ctx.font = fontOf(clip);
  const maxW = (P.width * 0.94) / Math.max(0.05, clip.scale);
  const lines = [];
  for (const raw of String(clip.text ?? '').split('\n')) {
    if (ctx.measureText(raw).width <= maxW) { lines.push(raw); continue; }
    let cur = '';
    for (const word of raw.split(' ')) {
      const test = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = word; } else cur = test;
    }
    lines.push(cur);
  }
  const widths = lines.map((l) => ctx.measureText(l).width);
  const lh = clip.size * (clip.lineHeight || 1.15);
  const pad = clip.bgOpacity > 0 ? clip.size * 0.28 : 0;
  return { lines, widths, w: Math.max(10, ...widths), h: lines.length * lh, lh, pad };
}

// Unskalierte Grundgröße eines Clips in Projektpixeln
export function baseSize(clip, P) {
  if (clip.type === 'text') { const l = layoutText(clip, P); return { w: l.w + l.pad * 2, h: l.h + l.pad * 1.2 }; }
  const m = getMedia(clip.mediaId);
  const sw = (m && m.width) || P.width, sh = (m && m.height) || P.height;
  const fit = Math.min(P.width / sw, P.height / sh);
  return { w: sw * fit, h: sh * fit };
}

export function clipBounds(clip, P, t = S.time) {
  const b = baseSize(clip, P); const l = Math.min(clip.duration, Math.max(0, t - clip.start));
  const sc = evalProp(clip, 'scale', l);
  return { cx: P.width / 2 + evalProp(clip, 'x', l), cy: P.height / 2 + evalProp(clip, 'y', l), w: b.w * sc, h: b.h * sc, rot: evalProp(clip, 'rotation', l) };
}

function drawText(ctx, clip, P, s, chars) {
  const lay = layoutText(clip, P);
  ctx.font = fontOf(clip); ctx.textBaseline = 'middle'; ctx.textAlign = clip.align || 'center';
  if (clip.bgOpacity > 0) {
    ctx.save(); ctx.globalAlpha *= clip.bgOpacity; ctx.fillStyle = clip.bgColor;
    const w = lay.w + lay.pad * 2, h = lay.h + lay.pad * 1.2;
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, clip.size * 0.18); ctx.fill(); ctx.restore();
  }
  const total = lay.lines.reduce((n, l) => n + l.length, 0);
  let remaining = chars == null ? Infinity : Math.floor(total * chars);
  const x = clip.align === 'left' ? -lay.w / 2 : clip.align === 'right' ? lay.w / 2 : 0;
  lay.lines.forEach((line, i) => {
    if (remaining <= 0) return;
    const txt = remaining >= line.length ? line : line.slice(0, remaining);
    remaining -= line.length;
    const y = -lay.h / 2 + lay.lh * (i + 0.5);
    if (clip.shadow > 0) {
      ctx.shadowColor = `rgba(0,0,0,${Math.min(1, clip.shadow)})`; ctx.shadowBlur = clip.size * 0.14 * s; ctx.shadowOffsetY = clip.size * 0.04 * s;
    }
    if (clip.strokeWidth > 0) {
      ctx.lineJoin = 'round'; ctx.lineWidth = clip.strokeWidth * 2; ctx.strokeStyle = clip.stroke; ctx.strokeText(txt, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = clip.color; ctx.fillText(txt, x, y);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  });
}

function drawMedia(ctx, clip, src, w, h, s, env) {
  // Zuschnitt und Maske als Schnittpfad
  const cr = clip.crop, hasCrop = cr && (cr.l || cr.r || cr.t || cr.b);
  if (hasCrop || (clip.mask && clip.mask !== 'none')) {
    const x0 = -w / 2 + w * (cr?.l || 0), y0 = -h / 2 + h * (cr?.t || 0);
    const cw = Math.max(1, w * (1 - (cr?.l || 0) - (cr?.r || 0))), ch = Math.max(1, h * (1 - (cr?.t || 0) - (cr?.b || 0)));
    ctx.beginPath();
    if (clip.mask === 'circle') ctx.ellipse(x0 + cw / 2, y0 + ch / 2, cw / 2, ch / 2, 0, 0, Math.PI * 2);
    else if (clip.mask === 'round') ctx.roundRect(x0, y0, cw, ch, Math.min(cw, ch) * 0.12);
    else if (clip.mask === 'square') { const q = Math.min(cw, ch); ctx.rect(x0 + (cw - q) / 2, y0 + (ch - q) / 2, q, q); }
    else if (clip.mask === 'heart') {
      const cx = x0 + cw / 2, q = Math.min(cw, ch), top = y0 + (ch - q) / 2;
      ctx.moveTo(cx, top + q * 0.3);
      ctx.bezierCurveTo(cx - q * 0.5, top - q * 0.1, cx - q * 0.75, top + q * 0.55, cx, top + q * 0.95);
      ctx.bezierCurveTo(cx + q * 0.75, top + q * 0.55, cx + q * 0.5, top - q * 0.1, cx, top + q * 0.3);
    } else ctx.rect(x0, y0, cw, ch);
    ctx.clip();
  }
  if (clip.chroma && clip.chroma.on) {
    const keyed = chromaKey(src.el, src.w, src.h, clip.chroma);
    if (keyed) { ctx.drawImage(keyed, -w / 2, -h / 2, w, h); return; }
  }
  const bg = clip.bg;
  if (bg && bg.remove && env.segmenter) {
    const cut = env.segmenter.cutout(src.el, src.w, src.h, !!bg.invert);
    if (cut) {
      if (bg.mode === 'blur') {
        const prev = ctx.filter;
        ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
        ctx.filter = (prev === 'none' ? '' : prev + ' ') + `blur(${(18 * s * Math.max(0.2, clip.scale)).toFixed(1)}px)`;
        ctx.drawImage(src.el, -w / 2 - w * 0.04, -h / 2 - h * 0.04, w * 1.08, h * 1.08);
        ctx.restore(); ctx.filter = prev;
      } else if (bg.mode === 'color') {
        const prev = ctx.filter; ctx.filter = 'none';
        ctx.fillStyle = bg.color || '#00b140'; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.filter = prev;
      }
      ctx.drawImage(cut, -w / 2, -h / 2, w, h);
      return;
    }
  }
  ctx.drawImage(src.el, -w / 2, -h / 2, w, h);
}

function drawClip(ctx, clip, P, t, s, env, sc) {
  const local = t - clip.start;
  let src = null;
  if (clip.type !== 'text') {
    src = env.getSource(clip);
    if (!src) return;
  }
  const an = animState(clip, local, P);
  const ft = fxTransform(clip, t, local);
  const cl = Math.min(clip.duration, Math.max(0, local));
  const px = evalProp(clip, 'x', cl), py = evalProp(clip, 'y', cl), pscale = evalProp(clip, 'scale', cl), prot = evalProp(clip, 'rotation', cl);
  const alpha = Math.min(1, Math.max(0, evalProp(clip, 'opacity', cl))) * an.alpha;
  if (alpha <= 0.001) return;
  const blend = clip.blend && clip.blend !== 'source-over' ? clip.blend : null;
  const size = baseSize(clip, P);
  const f = clip.filter || {};
  const post = hasPostFx(clip);
  const tint = f.tint && f.tintAmt > 0;
  const needLayer = post || tint || an.wipe != null || alpha < 0.999 || !!blend;
  const target = needLayer ? sc.L.getContext('2d') : ctx;
  if (needLayer) { target.setTransform(1, 0, 0, 1, 0, 0); target.globalAlpha = 1; target.filter = 'none'; target.globalCompositeOperation = 'source-over'; target.clearRect(0, 0, sc.L.width, sc.L.height); }

  target.save();
  target.setTransform(s, 0, 0, s, s * (P.width / 2 + px + an.dx + ft.dx), s * (P.height / 2 + py + an.dy + ft.dy));
  target.rotate(((prot + an.rot) * Math.PI) / 180);
  const k = pscale * an.scale * ft.scale;
  target.scale(k * (clip.flip ? -1 : 1), k);
  target.filter = filterString(f, s, an.blur, ft.hue);
  if (clip.type === 'text') drawText(target, clip, P, s, an.chars);
  else drawMedia(target, clip, src, size.w, size.h, s, env);
  target.restore();
  target.filter = 'none';

  if (!needLayer) return;
  if (tint) {
    const m = sc.M.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0); m.globalAlpha = 1; m.filter = 'none'; m.globalCompositeOperation = 'copy';
    m.fillStyle = f.tint; m.fillRect(0, 0, sc.M.width, sc.M.height);
    m.globalCompositeOperation = 'destination-in'; m.drawImage(sc.L, 0, 0); m.globalCompositeOperation = 'source-over';
    target.setTransform(1, 0, 0, 1, 0, 0); target.globalCompositeOperation = 'soft-light'; target.globalAlpha = Math.min(1, f.tintAmt * 1.6);
    target.drawImage(sc.M, 0, 0); target.globalCompositeOperation = 'source-over'; target.globalAlpha = 1;
  }
  if (post) applyPostFx(clip, t, sc.L, sc.M, sc.T, s);

  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha;
  if (blend) ctx.globalCompositeOperation = blend;
  if (an.wipe != null) {
    const W = sc.L.width, H = sc.L.height, ww = W * an.wipe.p;
    ctx.beginPath(); ctx.rect(an.wipe.fromRight ? W - ww : 0, 0, ww, H); ctx.clip();
  }
  ctx.drawImage(sc.L, 0, 0); ctx.restore();
}

// Zeichnet die gesamte Timeline zum Zeitpunkt t. env.getSource(clip) liefert { el, w, h } oder null.
export function drawFrame(canvas, t, env) {
  const P = S.project;
  const ctx = canvas.getContext('2d');
  const s = canvas.width / P.width;
  const sc = getScratch(canvas.width, canvas.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tracks = P.tracks;
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i];
    if (tr.kind === 'audio' || tr.hidden) continue;
    for (const clip of P.clips) {
      if (clip.trackId !== tr.id) continue;
      if (t < clip.start - 1e-6 || t >= clip.start + clip.duration - 1e-6) continue;
      try { drawClip(ctx, clip, P, t, s, env, sc); } catch (e) { if (!drawFrame.warned) { drawFrame.warned = true; console.error('Zeichenfehler', e); } }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = 'none';
}

// Oberster sichtbarer Clip an einer Projektposition (für Auswahl in der Vorschau)
export function hitTest(px, py, t) {
  const P = S.project;
  for (const tr of P.tracks) {
    if (tr.kind === 'audio' || tr.hidden) continue;
    const clips = P.clips.filter((c) => c.trackId === tr.id && t >= c.start && t < c.start + c.duration);
    for (const c of clips.reverse()) {
      const b = clipBounds(c, P, t);
      const a = (-b.rot * Math.PI) / 180, dx = px - b.cx, dy = py - b.cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return c;
    }
  }
  return null;
}

export const isAudible = (clip) => {
  if (clip.type !== 'video' && clip.type !== 'audio') return false;
  const m = getMedia(clip.mediaId), tr = getTrack(clip.trackId);
  return !!(m && m.hasAudio && tr && !tr.muted && !clip.muted && clip.volume > 0);
};

// Tonplan der Timeline für FFmpeg (Export und Untertitel-Erkennung)
export function audioPlan() {
  const P = S.project;
  const duration = P.clips.reduce((mx, c) => Math.max(mx, c.start + c.duration), 0);
  const clips = P.clips.filter(isAudible).map((c) => ({
    path: getMedia(c.mediaId).path, srcStart: c.offset, srcDur: c.duration * c.speed, start: c.start, speed: c.speed,
    volume: c.volume, fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0, afx: c.afx && c.afx !== 'none' ? c.afx : null,
  }));
  return { duration, clips };
}
