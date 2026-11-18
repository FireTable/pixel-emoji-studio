// Tessera-small in the browser: CLIP text encoder + denoiser via onnxruntime-web (WebGPU, or CPU),
// with the masked-diffusion sampler ported from tessera/sampler.py (16 steps, CFG 3,
// confidence-ordered unmasking with Gumbel choice noise and spatial NMS).

import { ClipTokenizer } from "./tokenizer.js";

const ORT_VERSION = "1.22.0";
const ORT_DIR = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
export const GRID = 16;
export const N = GRID * GRID;
export const K = 512;
export const MASK = 512;
const TEXT_LEN = 24;
const TEXT_DIM = 512;
/** Error message for a run whose logits came back NaN or infinite. The client matches on it. */
export const BAD_OUTPUT = "bad-model-output";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function webgpuAvailable() {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Check the model's output for one fixed prompt against a reference computed on the CPU.
 * Some GPUs and drivers run the model without an error but return NaN or garbage, so a
 * session that loads isn't proof that it works. Returns why it failed, or null if it passed.
 */
async function selfTest(ort, den, clip, ref) {
  const text = await clip.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ref.ids, BigInt), [1, TEXT_LEN]),
  });
  const out = await den.run({
    x: new ort.Tensor("int64", new BigInt64Array(N).fill(BigInt(MASK)), [1, N]),
    text_states: text.last_hidden_state,
    text_pooled: text.pooler_output,
    mask_ratio: new ort.Tensor("float32", new Float32Array([1]), [1]),
    sc_probs: new ort.Tensor("float32", new Float32Array(N * K), [1, N, K]),
    drop_text: new ort.Tensor("bool", new Uint8Array(1), [1]),
  });
  const logits = out.logits.data;
  let agree = 0;
  let topDiff = 0;
  for (let i = 0; i < N; i++) {
    let best = 0;
    for (let j = 0; j < K; j++) {
      const v = logits[i * K + j];
      if (!Number.isFinite(v)) return `logit ${i * K + j} is ${v}`;
      if (v > logits[i * K + best]) best = j;
    }
    if (best === ref.argmax[i]) agree++;
    topDiff += Math.abs(logits[i * K + best] - ref.top[i]);
  }
  const agreement = agree / N;
  const meanTopDiff = topDiff / N;
  if (agreement < 0.8 || meanTopDiff > 0.5) {
    return `output doesn't match the reference (agreement ${agreement.toFixed(2)}, top-logit error ${meanTopDiff.toFixed(2)})`;
  }
  return null;
}

/**
 * Build the engine from already-downloaded model bytes. Runs on WebGPU when it passes the
 * self-test, otherwise on the CPU (WebAssembly). Meant to run inside a Web Worker.
 */
export async function createEngine(bytes, tokJson, palette, selfTestRef, { forceCpu = false, onStage } = {}) {
  const ort = await import(/* @vite-ignore */ `${ORT_DIR}ort.webgpu.min.mjs`);
  ort.env.wasm.wasmPaths = ORT_DIR;
  const tokenizer = new ClipTokenizer(tokJson);

  // One session at a time, so the peak memory holds one model's copy, not both.
  // Constant folding is off because it would expand every int8 weight into an fp32 copy at load
  // time, about 4x the memory, which is more than phones give a tab. The weights are dequantized
  // on the fly instead.
  const create = async (ep) => {
    onStage?.("load");
    const opts = {
      executionProviders: [ep],
      graphOptimizationLevel: "all",
      extra: { optimization: { disable_specified_optimizers: "ConstantFolding" } },
    };
    const den = await ort.InferenceSession.create(bytes.den, opts);
    const clip = await ort.InferenceSession.create(bytes.clip, opts);
    return [den, clip];
  };
  const onCpu = async (fallbackReason) => {
    const [den, clip] = await create("wasm");
    return new Engine(ort, den, clip, tokenizer, palette, "cpu", fallbackReason);
  };

  if (forceCpu) return onCpu("forced");
  if (!(await webgpuAvailable())) return onCpu("no-webgpu");

  let den, clip;
  try {
    [den, clip] = await create("webgpu");
  } catch (e) {
    console.warn("WebGPU session failed, falling back to the CPU", e);
    return onCpu("gpu-error");
  }

  onStage?.("check");
  let failure;
  try {
    failure = await selfTest(ort, den, clip, selfTestRef);
  } catch (e) {
    failure = String(e?.message ?? e);
  }
  if (!failure) return new Engine(ort, den, clip, tokenizer, palette, "webgpu", null);

  console.warn(`WebGPU failed the self-test (${failure}), falling back to the CPU`);
  await Promise.all([den.release(), clip.release()]);
  return onCpu("gpu-bad-output");
}

export class Engine {
  constructor(ort, den, clip, tokenizer, palette, device, fallbackReason) {
    this.device = device;
    this.fallbackReason = fallbackReason;
    this.ort = ort;
    this.den = den;
    this.clip = clip;
    this.tokenizer = tokenizer;
    this.palette = palette;
  }

  async encodeText(prompt) {
    const ids = this.tokenizer.encodeFixed(prompt, TEXT_LEN);
    const out = await this.clip.run({
      input_ids: new this.ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, TEXT_LEN]),
    });
    return { states: out.last_hidden_state.data, pooled: out.pooler_output.data };
  }

  /**
   * Generate `n` sprites for one prompt. onStep(step, tokens, masked) is awaited after every step
   * so the caller can paint the canvas filling in.
   */
  async generate(prompt, { n = 4, seed = 0, steps = 16, cfgScale = 3, choiceTemperature = 2, nmsThreshold = 0.9, onStep } = {}) {
    const { Tensor } = this.ort;
    const rand = mulberry32(seed);
    const { states, pooled } = await this.encodeText(prompt);
    const B2 = n * 2;

    const ts = new Float32Array(B2 * TEXT_LEN * TEXT_DIM);
    const tp = new Float32Array(B2 * TEXT_DIM);
    for (let i = 0; i < B2; i++) {
      ts.set(states, i * TEXT_LEN * TEXT_DIM);
      tp.set(pooled, i * TEXT_DIM);
    }
    const drop = Uint8Array.from({ length: B2 }, (_, i) => (i >= n ? 1 : 0));
    const tsT = new Tensor("float32", ts, [B2, TEXT_LEN, TEXT_DIM]);
    const tpT = new Tensor("float32", tp, [B2, TEXT_DIM]);
    const dropT = new Tensor("bool", drop, [B2]);

    const x = new Int32Array(n * N).fill(MASK);
    const masked = new Uint8Array(n * N).fill(1);
    const sc = new Float32Array(B2 * N * K);
    const guided = new Float32Array(N * K);
    const probs = new Float32Array(N * K);
    const sampled = new Int32Array(N);
    const pSel = new Float32Array(N);
    const score = new Float32Array(N);
    const nStart = N;

    for (let k = 0; k < steps; k++) {
      const frac = (k + 1) / steps;
      const x2 = new BigInt64Array(B2 * N);
      const ratio = new Float32Array(B2);
      for (let b = 0; b < n; b++) {
        let m = 0;
        for (let i = 0; i < N; i++) {
          const v = BigInt(x[b * N + i]);
          x2[b * N + i] = v;
          x2[(b + n) * N + i] = v;
          m += masked[b * N + i];
        }
        ratio[b] = ratio[b + n] = m / N;
      }
      const out = await this.den.run({
        x: new Tensor("int64", x2, [B2, N]),
        text_states: tsT,
        text_pooled: tpT,
        mask_ratio: new Tensor("float32", ratio, [B2]),
        sc_probs: new Tensor("float32", sc, [B2, N, K]),
        drop_text: dropT,
      });
      const logits = out.logits.data;
      for (let i = 0; i < logits.length; i++) {
        if (!Number.isFinite(logits[i])) throw new Error(BAD_OUTPUT);
      }

      for (let b = 0; b < n; b++) {
        const cOff = b * N * K;
        const uOff = (b + n) * N * K;
        // Classifier-free guidance, softmax, and one categorical sample per pixel.
        for (let i = 0; i < N; i++) {
          const row = i * K;
          let max = -Infinity;
          for (let j = 0; j < K; j++) {
            const lu = logits[uOff + row + j];
            const g = lu + cfgScale * (logits[cOff + row + j] - lu);
            guided[row + j] = g;
            if (g > max) max = g;
          }
          let sum = 0;
          for (let j = 0; j < K; j++) {
            const e = Math.exp(guided[row + j] - max);
            probs[row + j] = e;
            sum += e;
          }
          let u = rand() * sum;
          let pick = K - 1;
          for (let j = 0; j < K; j++) {
            u -= probs[row + j];
            if (u <= 0) {
              pick = j;
              break;
            }
          }
          for (let j = 0; j < K; j++) probs[row + j] /= sum;
          sampled[i] = pick;
          pSel[i] = probs[row + pick];
        }

        // How many pixels to commit this step (cosine schedule).
        let nMasked = 0;
        for (let i = 0; i < N; i++) nMasked += masked[b * N + i];
        let remaining = Math.floor(nStart * Math.cos((Math.PI / 2) * frac));
        if (k === steps - 1) remaining = 0;
        const nCommit = Math.min(Math.max(nMasked - remaining, 1), nMasked);

        // Confidence score with annealed Gumbel noise.
        for (let i = 0; i < N; i++) {
          let u = rand();
          u = Math.min(Math.max(u, 1e-10), 1 - 1e-10);
          const gumbel = -Math.log(-Math.log(u));
          score[i] = Math.log(Math.max(pSel[i], 1e-12)) + choiceTemperature * (1 - frac) * gumbel;
        }

        // Spatial NMS: prefer certain pixels and local maxima among uncertain masked ones.
        const order = [];
        for (let i = 0; i < N; i++) {
          if (!masked[b * N + i]) continue;
          const certain = pSel[i] >= nmsThreshold;
          let elig = certain;
          if (!certain) {
            const r = (i / GRID) | 0;
            const c = i % GRID;
            let localMax = -Infinity;
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const rr = r + dr;
                const cc = c + dc;
                if (rr < 0 || rr >= GRID || cc < 0 || cc >= GRID) continue;
                const j = rr * GRID + cc;
                if (masked[b * N + j] && pSel[j] < nmsThreshold && score[j] > localMax) localMax = score[j];
              }
            }
            elig = score[i] >= localMax;
          }
          order.push([score[i] + (elig ? 1e4 : 0), i]);
        }
        order.sort((a, c) => c[0] - a[0]);
        for (let q = 0; q < nCommit && q < order.length; q++) {
          const i = order[q][1];
          x[b * N + i] = sampled[i];
          masked[b * N + i] = 0;
        }

        // Self-conditioning: feed this step's guided distribution to both CFG branches.
        sc.set(probs, b * N * K);
        sc.set(probs, (b + n) * N * K);
      }
      if (onStep) await onStep(k, x, masked);
    }
    return x;
  }
}
