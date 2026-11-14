// Export: jedes Bild wird mit demselben Compositor wie die Vorschau gezeichnet und an FFmpeg (H.264 + AAC) übergeben
import { S, projectDuration, toast } from './state.js';
import { drawFrame, audioPlan } from './render.js';
import { player, pause, seekExact, renderEnv, requestDraw } from './player.js';

const api = window.api;
const modal = document.getElementById('modal');
const box = document.getElementById('modalBox');
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
const closeModal = () => { modal.classList.add('hidden'); box.textContent = ''; };

export async function runExport({ outPath, scale, fps, crf, format = 'mp4', onProgress, isCancelled }) {
  const P = S.project;
  const canvas = document.createElement('canvas');
  canvas.width = even(P.width * scale); canvas.height = even(P.height * scale);
  const plan = audioPlan();
  const frames = Math.max(1, Math.ceil(plan.duration * fps - 1e-6));
  plan.duration = frames / fps;
  pause(); player.exporting = true;
  let started = false;
  try {
    await api.exportStart({ outPath, fps, crf, format, audio: plan });
    started = true;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      if (isCancelled()) { await api.exportCancel(outPath); return false; }
      const t = i / fps;
      await seekExact(t);
      drawFrame(canvas, t, renderEnv);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.94));
      await api.exportFrame(await blob.arrayBuffer());
      if (i % 3 === 0) onProgress((i + 1) / frames, (performance.now() - t0) / 1000);
    }
    onProgress(1, (performance.now() - t0) / 1000);
    await api.exportEnd();
    return true;
  } catch (e) {
    if (started) await api.exportCancel(outPath).catch(() => {});
    throw e;
  } finally {
    player.exporting = false; requestDraw();
  }
}

export function openExportDialog() {
  if (projectDuration() <= 0) { toast('Die Timeline ist leer – füge zuerst Clips hinzu.'); return; }
  const P = S.project;
  box.innerHTML = `
    <h2>Video exportieren</h2>
    <div class="fld"><label>Format</label><select id="exFmt"><option value="mp4">MP4-Video (H.264 + AAC)</option><option value="gif">GIF-Animation (ohne Ton)</option><option value="mp3">Nur Ton (MP3)</option><option value="wav">Nur Ton (WAV)</option></select></div>
    <div class="fld"><label>Auflösung</label><select id="exRes"></select></div>
    <div class="fld"><label>Bildrate</label><select id="exFps"><option>24</option><option>25</option><option selected>30</option><option>50</option><option>60</option></select></div>
    <div class="fld"><label>Qualität</label><select id="exQ"><option value="17">Sehr hoch (große Datei)</option><option value="20" selected>Hoch</option><option value="24">Mittel</option><option value="28">Klein (kleine Datei)</option></select></div>
    <p class="hint">Ohne Wasserzeichen. Länge: ${projectDuration().toFixed(1)} s</p>
    <div class="actions"><button class="btn" id="exCancel">Abbrechen</button><button class="btn primary" id="exGo">Exportieren</button></div>`;
  const res = box.querySelector('#exRes');
  for (const [k, n] of [[1, 'Original'], [2 / 3, 'Mittel'], [0.5, 'Klein']]) {
    const o = document.createElement('option'); o.value = k; o.textContent = `${n} – ${even(P.width * k)} × ${even(P.height * k)}`; res.appendChild(o);
  }
  box.querySelector('#exFps').value = String(P.fps);
  modal.classList.remove('hidden');
  const fmtSel = box.querySelector('#exFmt');
  fmtSel.onchange = () => {
    const f = fmtSel.value, audio = f === 'mp3' || f === 'wav';
    for (const id of ['exRes', 'exFps', 'exQ']) box.querySelector('#' + id).disabled = audio || (id === 'exQ' && f === 'gif');
    if (f === 'gif') { res.selectedIndex = 2; box.querySelector('#exFps').value = '15'; }
  };
  box.querySelector('#exFps').insertAdjacentHTML('afterbegin', '<option>10</option><option>15</option>');
  box.querySelector('#exFps').value = String(P.fps);
  box.querySelector('#exCancel').onclick = closeModal;
  box.querySelector('#exGo').onclick = async () => {
    const scale = +res.value, fps = +box.querySelector('#exFps').value, crf = +box.querySelector('#exQ').value;
    const format = fmtSel.value;
    const outPath = await api.saveExportDialog(P.name, format);
    if (!outPath) return;
    if (format === 'mp3' || format === 'wav') {
      box.innerHTML = '<h2>Ton wird exportiert …</h2><p class="hint">Bitte einen Moment warten.</p>';
      try {
        await api.exportAudio(audioPlan(), outPath);
        box.innerHTML = '<h2>Export fertig ✓</h2><p class="hint" style="user-select:text;word-break:break-all"></p><div class="actions"><button class="btn" id="exShow">Im Ordner anzeigen</button><button class="btn primary" id="exOk">Schließen</button></div>';
        box.querySelector('p').textContent = outPath; box.querySelector('#exShow').onclick = () => api.showItem(outPath); box.querySelector('#exOk').onclick = closeModal;
      } catch (e) {
        box.innerHTML = '<h2>Export fehlgeschlagen</h2><p class="hint" style="user-select:text;white-space:pre-wrap"></p><div class="actions"><button class="btn primary" id="exOk">Schließen</button></div>';
        box.querySelector('p').textContent = e.message; box.querySelector('#exOk').onclick = closeModal;
      }
      return;
    }
    let cancelled = false;
    box.innerHTML = `<h2>Export läuft …</h2><div class="big" id="exPct">0 %</div><div class="bar"><div id="exBar"></div></div>
      <p class="hint" id="exEta">Bitte das Fenster geöffnet lassen.</p><div class="actions"><button class="btn danger" id="exStop">Abbrechen</button></div>`;
    box.querySelector('#exStop').onclick = () => { cancelled = true; };
    try {
      const ok = await runExport({
        outPath, scale, fps, crf, format, isCancelled: () => cancelled,
        onProgress: (p, el) => {
          box.querySelector('#exPct').textContent = `${Math.round(p * 100)} %`; box.querySelector('#exBar').style.width = `${p * 100}%`;
          if (p > 0.02) box.querySelector('#exEta').textContent = `Noch etwa ${Math.max(0, Math.round((el / p) * (1 - p)))} s`;
        },
      });
      if (!ok) { closeModal(); toast('Export abgebrochen.'); return; }
      box.innerHTML = `<h2>Export fertig ✓</h2><p class="hint" style="user-select:text;word-break:break-all"></p>
        <div class="actions"><button class="btn" id="exShow">Im Ordner anzeigen</button><button class="btn primary" id="exOk">Schließen</button></div>`;
      box.querySelector('p').textContent = outPath;
      box.querySelector('#exShow').onclick = () => api.showItem(outPath);
      box.querySelector('#exOk').onclick = closeModal;
    } catch (e) {
      console.error(e);
      box.innerHTML = '<h2>Export fehlgeschlagen</h2><p class="hint" style="user-select:text;white-space:pre-wrap;max-height:200px;overflow:auto"></p><div class="actions"><button class="btn primary" id="exOk">Schließen</button></div>';
      box.querySelector('p').textContent = e.message; box.querySelector('#exOk').onclick = closeModal;
    }
  };
}
