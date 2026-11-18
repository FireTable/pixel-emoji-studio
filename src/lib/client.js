// Main-thread side: downloads (with progress and the Cache API), the worker, and pixels.
import { BAD_OUTPUT } from "./engine.js";

export const GRID = 16;
export const N = GRID * GRID;
const K = 512;
const MODEL_URL = "https://cdn.firetable.tech/file/emoji/tessera-8e8aecc";
const CACHE = "emoji-studio-tessera-8e8aecc";
const SHARD_BYTES = 16 * 1024 * 1024;
const SHARDS_PER_BATCH = 2;
const FORCE_CPU_KEY = "slack-moji:force-cpu";
// Set while the model loads into memory, cleared once it is ready. If it is still set on the next
// visit, the browser killed the tab mid-load, almost always because it ran out of memory.
const LOADING_KEY = "slack-moji:loading";
const PREVIEW_INTERVAL = 45;

export const FILES = [
  { key: "den", name: "tessera_w8", bytes: 50840032 },
  { key: "clip", name: "clip_text_w8", bytes: 64060515 },
];

async function openCache() {
  try {
    return await caches.open(CACHE);
  } catch {
    return null;
  }
}

async function downloadShard(file, index, out, cache, signal, onBytes) {
  const url = `${MODEL_URL}/${file.name}.${index + 1}.bin`;
  const offset = index * SHARD_BYTES;
  const end = Math.min(offset + SHARD_BYTES, file.bytes);
  const cached = await cache?.match(url).catch(() => null);
  const response = cached ?? await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Couldn't download ${file.name} part ${index + 1} (HTTP ${response.status}).`);
  }

  const reader = response.body.getReader();
  let cursor = offset;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (cursor + value.byteLength > end) throw new Error("Unexpected model file size.");
      out.set(value, cursor);
      cursor += value.byteLength;
      onBytes(value.byteLength);
    }
    if (cursor !== end) throw new Error("The model download stopped early. Try again.");
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (cached) await cache.delete(url).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!cached && cache) {
    await cache.put(url, new Response(out.subarray(offset, end))).catch(() => {});
  }
}

async function fetchBytes(file, cache, signal, onBytes, batch = SHARDS_PER_BATCH) {
  const out = new Uint8Array(file.bytes);
  const parts = Array.from({ length: Math.ceil(file.bytes / SHARD_BYTES) }, (_, index) => index);
  for (let i = 0; i < parts.length; i += batch) {
    await Promise.all(parts.slice(i, i + batch).map((part) =>
      downloadShard(file, part, out, cache, signal, onBytes),
    ));
  }
  return out.buffer;
}

function shouldForceCpu() {
  if (new URLSearchParams(location.search).has("cpu")) return true;
  try {
    return localStorage.getItem(FORCE_CPU_KEY) === "1";
  } catch {
    return false;
  }
}

function setLoadingMarker(mode) {
  try {
    if (mode) sessionStorage.setItem(LOADING_KEY, mode);
    else sessionStorage.removeItem(LOADING_KEY);
  } catch {}
}

export function previousLoad() {
  try {
    const mode = sessionStorage.getItem(LOADING_KEY);
    if (mode) return mode;
    if (localStorage.getItem(LOADING_KEY)) {
      localStorage.removeItem(LOADING_KEY);
      return "standard";
    }
  } catch {}
  return null;
}

function rememberForceCpu() {
  try {
    localStorage.setItem(FORCE_CPU_KEY, "1");
  } catch {
    // Storage blocked: the user can still add ?cpu to the URL.
  }
}

/**
 * Download the models, start the worker, and resolve once it's ready. onProgress gets
 * { stage, loaded, total } where stage is "download", "load" (into memory) or "check" (GPU test).
 */
export async function loadEngine(onProgress, { recovery = false } = {}) {
  setLoadingMarker(recovery ? "recovery" : "standard");
  try {
    return await startEngine(onProgress, recovery);
  } finally {
    setLoadingMarker(null);
  }
}

async function startEngine(onProgress, recovery) {
  const cache = await openCache();
  const controller = new AbortController();
  const total = FILES.reduce((sum, file) => sum + file.bytes, 0);
  let loaded = 0;
  const onBytes = (bytes) => {
    loaded += bytes;
    onProgress?.({ stage: "download", loaded, total });
  };
  async function downloadModels() {
    if (!recovery) {
      return Promise.all(FILES.map((file) => fetchBytes(file, cache, controller.signal, onBytes)));
    }
    const models = [];
    for (const file of FILES) {
      models.push(await fetchBytes(file, cache, controller.signal, onBytes, 1));
    }
    return models;
  }
  const [tokJson, meta, selfTest, [den, clip]] = await Promise.all([
    ...["tokenizer.json", "meta.json", "selftest.json"].map(async (name) => {
      const response = await fetch(`/models/${name}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Couldn't load ${name} (HTTP ${response.status}).`);
      return response.json();
    }),
    downloadModels(),
  ]).catch((error) => {
    controller.abort();
    throw error;
  });
  const palette = new Uint8ClampedArray(K * 4);
  meta.palette_rgba.forEach((c, i) => palette.set(c, i * 4));

  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const started = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      if (e.data.type === "stage") onProgress?.({ stage: e.data.stage, loaded: total, total });
      else if (e.data.type === "ready") resolve(e.data);
      else if (e.data.type === "error") reject(new Error(e.data.message));
    };
    worker.onerror = (e) => reject(new Error(e.message || "The model worker failed to start"));
    worker.postMessage({ type: "init", bytes: { den, clip }, tokJson, palette, selfTest, forceCpu: recovery || shouldForceCpu() }, [den, clip]);
  });
  let device, fallbackReason;
  try {
    ({ device, fallbackReason } = await started);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  if (fallbackReason === "gpu-bad-output") rememberForceCpu();
  return new Client(worker, palette, device, fallbackReason);
}

class Client {
  constructor(worker, palette, device, fallbackReason) {
    this.worker = worker;
    this.palette = palette;
    this.device = device;
    this.fallbackReason = fallbackReason;
    this.nextId = 1;
  }

  /** Generate n sprites, showing only the latest preview when the browser paints. */
  generate(prompt, { n = 4, seed = 0, onStep, previewInterval = PREVIEW_INTERVAL } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let preview;
      let frame = 0;
      let nextPaint = 0;

      function paintPreview(time) {
        if (time < nextPaint) {
          frame = requestAnimationFrame(paintPreview);
          return;
        }
        frame = 0;
        nextPaint = time + previewInterval;
        const { step, x, masked } = preview;
        onStep(step, x, masked);
      }

      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.id !== id) return;
        if (m.type === "step") {
          if (!onStep) return;
          preview = m;
          if (!frame) frame = requestAnimationFrame(paintPreview);
        } else if (m.type === "done") {
          cancelAnimationFrame(frame);
          resolve(m.x);
        } else if (m.type === "error") {
          cancelAnimationFrame(frame);
          if (m.message !== BAD_OUTPUT) return reject(new Error(m.message));
          rememberForceCpu();
          reject(new Error("Your GPU returned broken numbers for this model. Reload the page and it will run on your CPU instead."));
        }
      };
      this.worker.postMessage({ type: "generate", id, prompt, n, seed });
    });
  }

  /** RGBA pixels for sprite b. Masked pixels get `maskColor`; token 0 is transparent. */
  toRGBA(x, masked, b, maskColor = [220, 220, 225, 255]) {
    const px = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < N; i++) {
      if (masked && masked[b * N + i]) px.set(maskColor, i * 4);
      else px.set(this.palette.subarray(x[b * N + i] * 4, x[b * N + i] * 4 + 4), i * 4);
    }
    return px;
  }
}
