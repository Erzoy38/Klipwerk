// Klipwerk – Start, Projektverwaltung, Tastenkürzel
import { S, on, emit, newProject, initHistory, undo, redo, canUndo, canRedo, commit, changed, projectDuration, fmtTime, toast, select, migrateProject, selectedClip, toggleKeyframe, touched } from './state.js';
import { player, play, pause, toggle, seek, layout } from './player.js';
import { build, splitAtPlayhead, deleteSelected, duplicateSelected, rippleDelete, copySelected, pasteClip } from './timeline.js';
import { saveSnapshot } from './tools.js';
import './inspector.js';
import { renderMedia } from './panels.js';
import { openExportDialog } from './exporter.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

function loadProject(p, path) {
  pause();
  S.project = p; S.selection = null; S.time = 0; S.filePath = path || null; S.dirty = false;
  initHistory();
  $('projName').value = p.name; $('aspect').value = `${p.width}x${p.height}`;
  layout(); renderMedia(); emit('project'); emit('selection'); emit('time'); emit('history');
}

async function confirmDiscard() { return !S.dirty || confirm('Ungespeicherte Änderungen verwerfen?'); }

async function save() {
  try {
    let path = S.filePath;
    if (!path) { path = await api.saveProjectDialog(S.project.name); if (!path) return; }
    await api.writeProject(path, JSON.stringify(S.project));
    S.filePath = path; S.dirty = false; api.autosaveClear(); toast('Projekt gespeichert.', 'ok');
  } catch (e) {
    S.filePath = null; toast(`Speichern fehlgeschlagen: ${e.message}`, 'error');
  }
}
async function open() {
  if (!(await confirmDiscard())) return;
  const r = await api.openProject(); if (!r) return;
  try {
    const p = JSON.parse(r.text);
    if (!p || !Array.isArray(p.clips) || !Array.isArray(p.tracks) || !Array.isArray(p.media)) throw new Error('keine gültige Projektdatei');
    const missing = [];
    for (const m of p.media) if (!(await api.exists(m.path))) missing.push(m.name);
    loadProject(migrateProject(p), r.path);
    if (missing.length) toast(`Diese Dateien wurden nicht gefunden: ${missing.join(', ')}`, 'error', 9000);
  } catch (e) { toast(`Projekt konnte nicht geöffnet werden: ${e.message}`, 'error'); }
}

$('btnNew').onclick = async () => { if (await confirmDiscard()) { loadProject(newProject()); api.autosaveClear(); } };
$('btnSnap').onclick = saveSnapshot;
$('btnOpen').onclick = open;
$('btnSave').onclick = save;
$('btnUndo').onclick = undo;
$('btnRedo').onclick = redo;
$('btnExport').onclick = openExportDialog;
$('projName').onchange = (e) => { S.project.name = e.target.value.trim() || 'Mein Video'; S.dirty = true; };
$('aspect').onchange = (e) => {
  const [w, h] = e.target.value.split('x').map(Number);
  S.project.width = w; S.project.height = h; commit(); layout(); changed();
};

$('btnPlay').onclick = toggle;
$('btnStart').onclick = () => seek(0);
$('btnEnd').onclick = () => seek(projectDuration());
const stepFrame = (d) => { pause(); seek(Math.round(S.time * S.project.fps + d) / S.project.fps); };
$('btnBack').onclick = () => stepFrame(-1);
$('btnFwd').onclick = () => stepFrame(1);

on('playstate', () => { $('btnPlay').textContent = player.playing ? '❚❚' : '▶'; });
on('history', () => { $('btnUndo').disabled = !canUndo(); $('btnRedo').disabled = !canRedo(); });
on('project', () => {
  $('timeTotal').textContent = fmtTime(projectDuration(), S.project.fps);
  $('emptyHint').classList.toggle('hidden', S.project.clips.length > 0);
  $('aspect').value = `${S.project.width}x${S.project.height}`;
  if (S.time > projectDuration()) seek(projectDuration());
  layout();
});
on('labels', () => { $('timeTotal').textContent = fmtTime(projectDuration(), S.project.fps); });

window.addEventListener('keydown', (e) => {
  if (!$('modal').classList.contains('hidden')) return;
  const tag = e.target.tagName;
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox');
  const ctrl = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
  if (ctrl && k === 's') { e.preventDefault(); save(); return; }
  if (ctrl && k === 'o') { e.preventDefault(); open(); return; }
  if (typing) return;
  if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (ctrl && k === 'y') { e.preventDefault(); redo(); }
  else if (ctrl && k === 'd') { e.preventDefault(); duplicateSelected(); }
  else if (ctrl && k === 'c') { e.preventDefault(); copySelected(); }
  else if (ctrl && k === 'v') { e.preventDefault(); pasteClip(); }
  else if (k === 'k' && !ctrl) { const c = selectedClip(); if (c && c.type !== 'audio') { toggleKeyframe(c); touched(); commit(); emit('labels'); emit('props'); } }
  else if ((k === 'delete' || k === 'backspace') && e.shiftKey) rippleDelete();
  else if (ctrl && k === 'b') { e.preventDefault(); splitAtPlayhead(); }
  else if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (k === 's' && !ctrl) splitAtPlayhead();
  else if (k === 'delete' || k === 'backspace') deleteSelected();
  else if (k === 'arrowleft') { e.preventDefault(); stepFrame(e.shiftKey ? -10 : -1); }
  else if (k === 'arrowright') { e.preventDefault(); stepFrame(e.shiftKey ? 10 : 1); }
  else if (k === 'home') seek(0);
  else if (k === 'end') seek(projectDuration());
  else if (k === 'escape') select(null);
});
// Leertaste soll nie versehentlich einen fokussierten Button auslösen
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
window.addEventListener('beforeunload', (e) => { if (S.dirty && !window.__skipDirtyCheck) { e.preventDefault(); e.returnValue = ''; } });

loadProject(newProject());
build();

// Automatische Sicherung: alle 30 Sekunden, Wiederherstellung beim nächsten Start
let lastAuto = '';
setInterval(() => {
  if (!S.dirty || !S.project.clips.length) return;
  const json = JSON.stringify(S.project);
  if (json !== lastAuto) { lastAuto = json; api.autosaveWrite(json).catch(() => {}); }
}, 30000);
api.autosaveRead().then((text) => {
  if (!text || window.__noRestore) return;
  try {
    const p = JSON.parse(text);
    if (!p.clips?.length) return;
    if (confirm('Es gibt eine automatische Sicherung der letzten Sitzung. Wiederherstellen?')) { loadProject(migrateProject(p)); S.dirty = true; }
    else api.autosaveClear();
  } catch { api.autosaveClear(); }
});
window.__klipwerk = { S, emit, seek, play, pause }; // für Diagnose und Tests
