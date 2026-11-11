// Spracherkennung (Whisper) in einem Web Worker – läuft lokal über WebAssembly.
// Das Modell wird beim ersten Mal einmalig von Hugging Face geladen und danach aus dem Cache verwendet.
import { pipeline, env } from '../../node_modules/@huggingface/transformers/dist/transformers.min.js';

// Modelle im Ordner assets/models/<Name> werden zuerst verwendet (komplett offline); sonst einmaliger Download.
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.localModelPath = new URL('../../assets/models/', import.meta.url).href;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('../../node_modules/@huggingface/transformers/dist/', import.meta.url).href;
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1;

let asr = null; let loaded = null;

async function load(model) {
  if (asr && loaded === model) return;
  if (asr) { try { await asr.dispose(); } catch {} asr = null; }
  const files = new Map();
  asr = await pipeline('automatic-speech-recognition', model, {
    device: 'wasm', dtype: 'q8',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        files.set(p.file, [p.loaded, p.total]);
        let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; }
        self.postMessage({ type: 'download', value: t ? l / t : 0 });
      }
    },
  });
  loaded = model;
}

self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.type === 'load') { await load(d.model); self.postMessage({ type: 'loaded', id: d.id }); return; }
    if (d.type === 'run') {
      await load(d.model);
      const out = await asr(d.audio, { return_timestamps: true, language: d.language, task: 'transcribe', chunk_length_s: 30 });
      self.postMessage({ type: 'result', id: d.id, chunks: out.chunks || [], text: out.text || '' });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: d.id, message: String(err?.message || err) });
  }
};
