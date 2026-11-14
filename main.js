// Klipwerk – Electron-Hauptprozess: Fenster, Dateizugriff, FFmpeg, Sprachausgabe, Export
const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const APP_ROOT = __dirname;
const FFMPEG = (() => {
  try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
})();

if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.tflite': 'application/octet-stream', '.map': 'application/json',
};
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

async function serveFile(request, filePath) {
  let stat;
  try { stat = await fsp.stat(filePath); } catch { return new Response('Nicht gefunden', { status: 404 }); }
  if (!stat.isFile()) return new Response('Nicht gefunden', { status: 404 });
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...ISOLATION };
  const range = request.headers.get('range');
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : Math.max(0, stat.size - parseInt(m[2], 10));
    let end = m[1] && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => {});
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { ...base, 'Content-Length': String(stat.size) } });
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {});
  return new Response(Readable.toWeb(stream), { status: 200, headers: { ...base, 'Content-Length': String(stat.size) } });
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/__media__') {
      const p = url.searchParams.get('p');
      if (!p || !path.isAbsolute(p)) return new Response('Ungültig', { status: 400 });
      return serveFile(request, p);
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const full = path.resolve(APP_ROOT, rel);
    if (full !== APP_ROOT && !full.startsWith(APP_ROOT + path.sep)) return new Response('Verboten', { status: 403 });
    return serveFile(request, full);
  });
}

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1100, minHeight: 680,
    backgroundColor: '#14151a', title: 'Klipwerk', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('app://klipwerk/src/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Schließen', 'Abbrechen'], defaultId: 1, cancelId: 1,
      title: 'Klipwerk', message: 'Es gibt ungespeicherte Änderungen. Trotzdem schließen?',
    });
    if (choice === 0) e.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

// ---------- Hilfsfunktionen ----------
const cacheDir = () => path.join(app.getPath('userData'), 'cache');
async function ensureCache() { await fsp.mkdir(cacheDir(), { recursive: true }); return cacheDir(); }
async function fileKey(p) {
  const st = await fsp.stat(p);
  return crypto.createHash('sha1').update(`${p}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
}

function runFfmpeg(args, { onStderr, collectStdout } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    const out = []; let err = '';
    proc.stdout.on('data', (d) => { if (collectStdout) out.push(d); });
    proc.stderr.on('data', (d) => { const s = d.toString(); err = (err + s).slice(-6000); if (onStderr) onStderr(s); });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stderr: err, stdout: collectStdout ? Buffer.concat(out) : null }));
  });
}

// Wie runFfmpeg, liefert aber die gesamte Protokollausgabe (für Analysen)
function runFfmpegFull(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true }); let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject); proc.on('close', () => resolve(err));
  });
}

function parseDuration(text) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

// Ton-Effekte: alle Ketten lassen die Länge unverändert, damit Bild und Ton synchron bleiben
const AFX = {
  enhance: ['highpass=f=85', 'lowpass=f=13000', 'afftdn=nr=20:nf=-30:tn=1',
    'acompressor=threshold=-22dB:ratio=3:attack=5:release=140:makeup=4', 'alimiter=limit=0.95'].join(','),
  deep: 'aresample=48000,asetrate=48000*0.8,aresample=48000,atempo=1.25',
  high: 'aresample=48000,asetrate=48000*1.35,aresample=48000,atempo=0.740741',
  robot: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75,volume=1.6",
  echo: 'aecho=0.8:0.7:140|280:0.4|0.22',
  hall: 'aecho=0.8:0.88:40|90|150|230:0.35|0.28|0.2|0.14',
  phone: 'highpass=f=450,lowpass=f=3000,acompressor=threshold=-20dB:ratio=6:makeup=5,alimiter=limit=0.9',
  radio: 'highpass=f=250,lowpass=f=5500,acompressor=threshold=-24dB:ratio=5:makeup=6,alimiter=limit=0.9',
};
const afxOf = (c) => (c.afx && AFX[c.afx]) || (c.enhance ? AFX.enhance : null);

function atempoChain(speed) {
  const parts = []; let s = Math.min(8, Math.max(0.125, speed || 1));
  while (s > 2.0001) { parts.push('atempo=2.0'); s /= 2; }
  while (s < 0.4999) { parts.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 0.0005) parts.push(`atempo=${s.toFixed(4)}`);
  return parts;
}

// Baut FFmpeg-Eingaben und Filtergraph für den Ton der gesamten Timeline
function buildAudio(plan, inputBase) {
  const inputs = []; const filters = []; const labels = [];
  const dur = Math.max(0.05, plan.duration);
  plan.clips.forEach((c, i) => {
    inputs.push('-ss', Math.max(0, c.srcStart).toFixed(3), '-t', Math.max(0.01, c.srcDur).toFixed(3), '-i', c.path);
    const f = [];
    if (afxOf(c)) f.push(afxOf(c));
    f.push(...atempoChain(c.speed));
    const outDur = c.srcDur / (c.speed || 1);
    f.push(`volume=${Math.max(0, c.volume).toFixed(3)}`);
    if (c.fadeIn > 0.01) f.push(`afade=t=in:st=0:d=${Math.min(c.fadeIn, outDur).toFixed(3)}`);
    if (c.fadeOut > 0.01) {
      const d = Math.min(c.fadeOut, outDur);
      f.push(`afade=t=out:st=${Math.max(0, outDur - d).toFixed(3)}:d=${d.toFixed(3)}`);
    }
    f.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo');
    f.push(`adelay=${Math.max(0, Math.round(c.start * 1000))}:all=1`);
    filters.push(`[${inputBase + i}:a:0]${f.join(',')}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${dur.toFixed(3)}[sil]`);
  filters.push(`[sil]${labels.join('')}amix=inputs=${labels.length + 1}:normalize=0:duration=longest,atrim=0:${dur.toFixed(3)}[aout]`);
  return { inputs, filter: filters.join(';') };
}

// ---------- IPC: Dialoge & Dateien ----------
const MEDIA_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const allowedProjectPaths = new Set();

ipcMain.handle('dialog:openMedia', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Medien importieren', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Medien', extensions: MEDIA_EXT }, { name: 'Alle Dateien', extensions: ['*'] }],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:saveProject', async (_e, name) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Projekt speichern', defaultPath: `${name || 'Projekt'}.klip`,
    filters: [{ name: 'Klipwerk-Projekt', extensions: ['klip'] }],
  });
  if (r.canceled || !r.filePath) return null;
  allowedProjectPaths.add(r.filePath); return r.filePath;
});
ipcMain.handle('dialog:openProject', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Projekt öffnen', properties: ['openFile'], filters: [{ name: 'Klipwerk-Projekt', extensions: ['klip', 'json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  allowedProjectPaths.add(r.filePaths[0]);
  return { path: r.filePaths[0], text: await fsp.readFile(r.filePaths[0], 'utf8') };
});
ipcMain.handle('project:write', async (_e, p, text) => {
  if (!allowedProjectPaths.has(p)) throw new Error('Pfad nicht freigegeben');
  await fsp.writeFile(p, text, 'utf8'); return true;
});
ipcMain.handle('dialog:saveExport', async (_e, name, ext = 'mp4') => {
  const kinds = { mp4: 'MP4-Video', gif: 'GIF-Animation', mp3: 'MP3-Audio', wav: 'WAV-Audio' };
  const r = await dialog.showSaveDialog(win, {
    title: 'Exportieren', defaultPath: path.join(app.getPath(ext === 'mp3' || ext === 'wav' ? 'music' : 'videos'), `${name || 'Video'}.${ext}`),
    filters: [{ name: kinds[ext] || ext, extensions: [ext] }],
  });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('shell:showItem', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('fs:exists', async (_e, p) => { try { await fsp.access(p); return true; } catch { return false; } });

// ---------- IPC: Medienanalyse ----------
ipcMain.handle('media:probe', async (_e, p) => {
  const r = await runFfmpeg(['-hide_banner', '-i', p]);
  const t = r.stderr;
  const v = /Stream #\d+:\d+.*?: Video: (\w+).*?,\s*(\d{2,5})x(\d{2,5})/.exec(t);
  const attached = /attached pic/.test(t);
  return {
    duration: parseDuration(t),
    hasVideo: !!v && !attached, hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(t),
    vcodec: v ? v[1] : null, width: v ? +v[2] : 0, height: v ? +v[3] : 0,
  };
});

// Wandelt nicht abspielbare Dateien (z. B. HEVC, MKV, AVI) in ein bearbeitbares MP4 um
ipcMain.handle('media:transcode', async (e, p) => {
  const dir = await ensureCache();
  const out = path.join(dir, `proxy_${await fileKey(p)}.mp4`);
  try { await fsp.access(out); return out; } catch {}
  const tmp = out + '.tmp.mp4';
  let total = 0;
  const r = await runFfmpeg(['-y', '-hide_banner', '-i', p, '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '30',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp], {
    onStderr: (s) => {
      if (!total) total = parseDuration(s);
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
      if (m && total) e.sender.send('progress', { id: 'transcode', value: Math.min(1, ((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])) / total) });
    },
  });
  if (r.code !== 0) { fsp.unlink(tmp).catch(() => {}); throw new Error('Umwandlung fehlgeschlagen: ' + r.stderr.slice(-300)); }
  await fsp.rename(tmp, out);
  return out;
});

// ---------- IPC: Ton ----------
ipcMain.handle('audio:renderPcm', async (_e, plan) => {
  const a = buildAudio(plan, 0);
  const r = await runFfmpeg(['-hide_banner', '-nostdin', ...a.inputs, '-filter_complex', a.filter, '-map', '[aout]',
    '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { collectStdout: true });
  if (r.code !== 0) throw new Error('Ton konnte nicht gelesen werden: ' + r.stderr.slice(-300));
  const b = r.stdout;
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});

ipcMain.handle('audio:process', async (_e, p, fx) => {
  if (!AFX[fx]) throw new Error('Unbekannter Effekt');
  const dir = await ensureCache();
  const out = path.join(dir, `afx_${fx}_${await fileKey(p)}.m4a`);
  try { await fsp.access(out); return out; } catch {}
  const tmp = out + '.tmp.m4a';
  const r = await runFfmpeg(['-y', '-hide_banner', '-i', p, '-vn', '-map', '0:a:0', '-af', AFX[fx], '-c:a', 'aac', '-b:a', '192k', tmp]);
  if (r.code !== 0) { fsp.unlink(tmp).catch(() => {}); throw new Error('Ton-Effekt fehlgeschlagen: ' + r.stderr.slice(-300)); }
  await fsp.rename(tmp, out);
  return out;
});


// Wellenform: Spitzenwerte (50 pro Sekunde) für die Anzeige in der Timeline
const peakCache = new Map();
ipcMain.handle('audio:peaks', async (_e, p) => {
  if (peakCache.has(p)) return peakCache.get(p);
  const RATE = 4000, WIN = 80;
  const peaks = []; let rest = Buffer.alloc(0); let cur = 0, n = 0;
  await new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-i', p, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'], { windowsHide: true });
    proc.stderr.on('data', () => {});
    proc.stdout.on('data', (d) => {
      const b = rest.length ? Buffer.concat([rest, d]) : d; const len = b.length - (b.length % 2);
      for (let i = 0; i < len; i += 2) {
        const v = Math.abs(b.readInt16LE(i)); if (v > cur) cur = v;
        if (++n === WIN) { peaks.push(Math.min(255, Math.round(Math.sqrt(cur / 32768) * 255))); cur = 0; n = 0; }
      }
      rest = b.subarray(len);
    });
    proc.on('error', resolve); proc.on('close', resolve);
  });
  const out = Uint8Array.from(peaks);
  if (peakCache.size > 40) peakCache.clear();
  peakCache.set(p, out);
  return out;
});

// Stille Abschnitte finden (für „Pausen entfernen“)
ipcMain.handle('audio:silences', async (_e, p, noiseDb, minDur) => {
  const r = await runFfmpegFull(['-hide_banner', '-nostdin', '-i', p, '-vn', '-map', '0:a:0',
    '-af', `silencedetect=noise=${Number(noiseDb) || -35}dB:d=${Number(minDur) || 0.4}`, '-f', 'null', '-']);
  const list = []; let start = null;
  for (const line of r.split(/\r?\n/)) {
    let m = /silence_start:\s*(-?[\d.]+)/.exec(line); if (m) { start = Math.max(0, parseFloat(m[1])); continue; }
    m = /silence_end:\s*([\d.]+)/.exec(line); if (m && start != null) { list.push([start, parseFloat(m[1])]); start = null; }
  }
  if (start != null) list.push([start, 1e9]);
  return list;
});

// Sprachaufnahme speichern (WebM vom Mikrofon -> WAV)
ipcMain.handle('rec:save', async (_e, buf) => {
  const dir = path.join(app.getPath('userData'), 'aufnahmen'); await fsp.mkdir(dir, { recursive: true });
  const base = path.join(dir, `aufnahme_${Date.now().toString(36)}`);
  await fsp.writeFile(base + '.webm', Buffer.from(buf));
  const r = await runFfmpeg(['-y', '-hide_banner', '-i', base + '.webm', '-vn', '-ac', '1', '-ar', '48000', base + '.wav']);
  fsp.unlink(base + '.webm').catch(() => {});
  if (r.code !== 0) throw new Error('Aufnahme konnte nicht gespeichert werden: ' + r.stderr.slice(-200));
  return base + '.wav';
});

ipcMain.handle('image:save', async (_e, buf) => {
  const dir = path.join(app.getPath('userData'), 'standbilder'); await fsp.mkdir(dir, { recursive: true });
  const out = path.join(dir, `standbild_${Date.now().toString(36)}.png`);
  await fsp.writeFile(out, Buffer.from(buf));
  return out;
});

// Clip rückwärts abspielen: Ausschnitt wird einmalig umgerechnet
ipcMain.handle('media:reverse', async (_e, p, start, dur, hasAudio) => {
  const dir = await ensureCache();
  const out = path.join(dir, `rev_${await fileKey(p)}_${Math.round(start * 1000)}_${Math.round(dur * 1000)}.mp4`);
  try { await fsp.access(out); return out; } catch {}
  const tmp = out + '.tmp.mp4';
  const args = ['-y', '-hide_banner', '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', p, '-vf', 'reverse'];
  if (hasAudio) args.push('-af', 'areverse', '-c:a', 'aac', '-b:a', '192k'); else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '30', '-movflags', '+faststart', tmp);
  const r = await runFfmpeg(args);
  if (r.code !== 0) { fsp.unlink(tmp).catch(() => {}); throw new Error('Rückwärts-Umrechnung fehlgeschlagen: ' + r.stderr.slice(-300)); }
  await fsp.rename(tmp, out);
  return out;
});

// Allgemeines Speichern/Öffnen (Untertitel, Einzelbilder)
const allowedOut = new Set();
ipcMain.handle('dialog:saveFile', async (_e, o) => {
  const r = await dialog.showSaveDialog(win, { title: o.title, defaultPath: path.join(app.getPath(o.folder || 'documents'), o.name), filters: o.filters });
  if (r.canceled || !r.filePath) return null;
  allowedOut.add(r.filePath); return r.filePath;
});
ipcMain.handle('file:write', async (_e, p, data) => {
  if (!allowedOut.has(p)) throw new Error('Pfad nicht freigegeben');
  await fsp.writeFile(p, typeof data === 'string' ? data : Buffer.from(data)); return true;
});
ipcMain.handle('dialog:openText', async (_e, o) => {
  const r = await dialog.showOpenDialog(win, { title: o.title, properties: ['openFile'], filters: o.filters });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], text: await fsp.readFile(r.filePaths[0], 'utf8') };
});

// Automatische Sicherung
const autosavePath = () => path.join(app.getPath('userData'), 'autosave.klip');
ipcMain.handle('autosave:write', async (_e, text) => { await fsp.writeFile(autosavePath(), text, 'utf8'); return true; });
ipcMain.handle('autosave:read', async () => { try { return await fsp.readFile(autosavePath(), 'utf8'); } catch { return null; } });
ipcMain.handle('autosave:clear', async () => { await fsp.unlink(autosavePath()).catch(() => {}); return true; });

// Nur den Ton der Timeline exportieren (MP3 oder WAV)
ipcMain.handle('export:audio', async (_e, plan, outPath) => {
  const a = buildAudio(plan, 0);
  const codec = /\.wav$/i.test(outPath) ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '192k'];
  const r = await runFfmpeg(['-y', '-hide_banner', '-nostdin', ...a.inputs, '-filter_complex', a.filter, '-map', '[aout]', ...codec, outPath]);
  if (r.code !== 0) throw new Error('Audio-Export fehlgeschlagen: ' + r.stderr.slice(-300));
  return true;
});

// ---------- IPC: Text-zu-Sprache (Windows-Sprachausgabe, offline) ----------
function runProc(cmd, args, env) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let proc;
    try { proc = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ...env } }); }
    catch (e) { return resolve({ code: -1, out: '', err: String(e) }); }
    proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { err += d.toString('utf8'); });
    proc.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    proc.on('close', (code) => resolve({ code, out, err }));
  });
}
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const PS_PRE = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ";

ipcMain.handle('tts:voices', async () => {
  if (process.platform === 'win32') {
    const r = await runProc('powershell.exe', [...PS_ARGS, PS_PRE +
      "$s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }"]);
    if (r.code !== 0) return { voices: [], error: r.err.slice(-300) };
    return { voices: r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [name, lang] = l.split('|'); return { name, lang }; }) };
  }
  const r = await runProc('espeak-ng', ['--version']);
  if (r.code === 0) return { voices: [{ name: 'de', lang: 'de-DE' }, { name: 'en', lang: 'en-US' }] };
  return { voices: [], error: 'Sprachausgabe ist nur unter Windows verfügbar.' };
});

ipcMain.handle('tts:speak', async (_e, { text, voice, rate }) => {
  const dir = path.join(app.getPath('userData'), 'tts');
  await fsp.mkdir(dir, { recursive: true });
  const stamp = Date.now().toString(36);
  const out = path.join(dir, `sprache_${stamp}.wav`);
  const txt = path.join(dir, `sprache_${stamp}.txt`);
  await fsp.writeFile(txt, text, 'utf8');
  try {
    let r;
    if (process.platform === 'win32') {
      const script = PS_PRE +
        "$t = [System.IO.File]::ReadAllText($env:KW_TEXT, [System.Text.Encoding]::UTF8); " +
        "if ($env:KW_VOICE) { $s.SelectVoice($env:KW_VOICE) }; $s.Rate = [int]$env:KW_RATE; " +
        "$s.SetOutputToWaveFile($env:KW_OUT); $s.Speak($t); $s.Dispose()";
      r = await runProc('powershell.exe', [...PS_ARGS, script],
        { KW_TEXT: txt, KW_OUT: out, KW_VOICE: voice || '', KW_RATE: String(Math.max(-10, Math.min(10, Math.round(rate || 0)))) });
    } else {
      r = await runProc('espeak-ng', ['-v', voice || 'de', '-s', String(170 + Math.round((rate || 0) * 12)), '-w', out, '-f', txt]);
    }
    if (r.code !== 0) throw new Error(r.err.slice(-300) || 'Sprachausgabe nicht verfügbar');
    await fsp.access(out);
    return out;
  } finally { fsp.unlink(txt).catch(() => {}); }
});

// ---------- IPC: Export ----------
let exportJob = null;
ipcMain.handle('export:start', async (e, o) => {
  if (exportJob) throw new Error('Es läuft bereits ein Export');
  const a = buildAudio(o.audio, 1);
  const args = o.format === 'gif' ? ['-y', '-hide_banner', '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-filter_complex', '[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', o.outPath]
  : ['-y', '-hide_banner', '-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    ...a.inputs, '-filter_complex', a.filter, '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', o.preset || 'medium', '-crf', String(o.crf ?? 20), '-pix_fmt', 'yuv420p', '-r', String(o.fps),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', o.audio.duration.toFixed(3), o.outPath];
  const proc = spawn(FFMPEG, args, { windowsHide: true });
  const job = { proc, stderr: '', done: null, failed: null };
  proc.stderr.on('data', (d) => { job.stderr = (job.stderr + d.toString()).slice(-6000); });
  proc.stdin.on('error', (err) => { job.failed = err; });
  job.done = new Promise((resolve) => {
    proc.on('error', (err) => { job.failed = err; resolve(-1); });
    proc.on('close', (code) => resolve(code));
  });
  exportJob = job;
  return true;
});
ipcMain.handle('export:frame', async (_e, buf) => {
  const job = exportJob;
  if (!job) throw new Error('Kein Export aktiv');
  if (job.failed || job.proc.exitCode !== null) throw new Error('FFmpeg wurde beendet: ' + job.stderr.slice(-400));
  await new Promise((resolve, reject) => {
    job.proc.stdin.write(Buffer.from(buf), (err) => (err ? reject(err) : resolve()));
  });
  return true;
});
ipcMain.handle('export:end', async () => {
  const job = exportJob;
  if (!job) throw new Error('Kein Export aktiv');
  job.proc.stdin.end();
  const code = await job.done;
  exportJob = null;
  if (code !== 0) throw new Error('Export fehlgeschlagen: ' + job.stderr.slice(-500));
  return true;
});
ipcMain.handle('export:cancel', async (_e, outPath) => {
  const job = exportJob; exportJob = null;
  if (job) { try { job.proc.stdin.destroy(); job.proc.kill('SIGKILL'); } catch {} await job.done; }
  if (outPath) fsp.unlink(outPath).catch(() => {});
  return true;
});

ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), tmp: os.tmpdir() }));

app.whenReady().then(() => {
  registerProtocol();
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' || permission === 'clipboard-sanitized-write'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (exportJob) { try { exportJob.proc.kill('SIGKILL'); } catch {} } app.quit(); });
