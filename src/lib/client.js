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
const STEP_MS = 45; // show every step long enough to see the pixels fill in

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

async function fetchBytes(file, cache, signal, onBytes) {
  const out = new Uint8Array(file.bytes);
  const parts = Array.from({ length: Math.ceil(file.bytes / SHARD_BYTES) }, (_, index) => index);
  for (let i = 0; i < parts.length; i += SHARDS_PER_BATCH) {
    await Promise.all(parts.slice(i, i + SHARDS_PER_BATCH).map((part) =>
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

function setLoadingMarker(on) {
  try {
    if (on) localStorage.setItem(LOADING_KEY, "1");
    else localStorage.removeItem(LOADING_KEY);
  } catch {
    // Storage blocked: we just can't detect a crash on the next visit.
  }
}

/** True if the last visit was killed while loading the model, so we shouldn't retry on our own. */
export function crashedLastTime() {
  try {
    return localStorage.getItem(LOADING_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberForceCpu() {
  try {
    localStorage.setItem(FORCE_CPU_KEY, "1");
  } catch {
    // Storage blocked: the user can still add ?cpu to the URL.
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Download the models, start the worker, and resolve once it's ready. onProgress gets
 * { stage, loaded, total } where stage is "download", "load" (into memory) or "check" (GPU test).
 */
export async function loadEngine(onProgress) {
  const cache = await openCache();
  const controller = new AbortController();
  const total = FILES.reduce((sum, file) => sum + file.bytes, 0);
  let loaded = 0;
  const onBytes = (bytes) => {
    loaded += bytes;
    onProgress?.({ stage: "download", loaded, total });
  };
  const [tokJson, meta, selfTest, [den, clip]] = await Promise.all([
    ...["tokenizer.json", "meta.json", "selftest.json"].map(async (name) => {
      const response = await fetch(`models/${name}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Couldn't load ${name} (HTTP ${response.status}).`);
      return response.json();
    }),
    Promise.all(FILES.map((file) => fetchBytes(file, cache, controller.signal, onBytes))),
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
    worker.postMessage({ type: "init", bytes: { den, clip }, tokJson, palette, selfTest, forceCpu: shouldForceCpu() }, [den, clip]);
  });
  // Only a killed tab leaves the marker behind: a normal error still clears it.
  setLoadingMarker(true);
  let device, fallbackReason;
  try {
    ({ device, fallbackReason } = await started);
  } catch (error) {
    worker.terminate();
    throw error;
  } finally {
    setLoadingMarker(false);
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

  /** Generate n sprites; onStep(step, tokens, masked) is called for every step, paced for display. */
  generate(prompt, { n = 4, seed = 0, onStep } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let chain = Promise.resolve();
      let step = 0;
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.id !== id) return;
        if (m.type === "step") {
          const k = step++;
          chain = chain.then(async () => {
            const t = performance.now();
            await onStep?.(k, m.x, m.masked);
            await sleep(Math.max(0, STEP_MS - (performance.now() - t)));
          });
        } else if (m.type === "done") chain.then(() => resolve(m.x));
        else if (m.type === "error") {
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
