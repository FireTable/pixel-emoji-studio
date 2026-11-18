// Runs model inference off the main thread on GPU or CPU.
import { createEngine } from "./engine.js";

let engine = null;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      engine = await createEngine(m.bytes, m.tokJson, m.palette, m.selfTest, {
        forceCpu: m.forceCpu,
        onStage: (stage) => self.postMessage({ type: "stage", stage }),
      });
      self.postMessage({ type: "ready", device: engine.device, fallbackReason: engine.fallbackReason });
      return;
    }
    if (m.type === "generate") {
      const x = await engine.generate(m.prompt, {
        n: m.n,
        seed: m.seed,
        onStep: (step, x, masked) => self.postMessage({ type: "step", id: m.id, step, x, masked }),
      });
      self.postMessage({ type: "done", id: m.id, x }, [x.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, message: String(err?.message ?? err) });
  }
};
