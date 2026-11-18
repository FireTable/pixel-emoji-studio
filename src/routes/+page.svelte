<script lang="ts">
  import { onMount, tick } from "svelte";
  import { loadEngine, crashedLastTime, GRID, N, FILES } from "$lib/client.js";
  import { repairOutline } from "$lib/outline.js";

  const EXAMPLES = ["cat wearing sunglasses", "slice of pizza", "ghost", "taco", "fire", "rubber duck", "energy drink"];
  const VARIANTS = 4;
  // Why the model is on the CPU, keyed by the engine's fallbackReason.
  const CPU_NOTES: Record<string, string> = {
    "no-webgpu": " (No WebGPU here, so it runs on your CPU.)",
    "gpu-error": " (WebGPU failed to start here, so it runs on your CPU.)",
    "gpu-bad-output": " (Your GPU gave wrong results in a quick check, so it runs on your CPU.)",
    forced: " (Running on your CPU.)",
  };

  type Status = "loading" | "crashed" | "ready" | "working" | "error";
  type LoadStage = "download" | "load" | "check";

  let status = $state<Status>("loading");
  let errorText = $state("");
  let loaded = $state(0);
  let total = $state(FILES.reduce((sum, f) => sum + f.bytes, 0));
  let loadStage = $state<LoadStage>("download");
  // The loader paints this sprite in, pixel by pixel, as the model downloads.
  let loaderSprite = $state<ImageData | null>(null);
  let prompt = $state(EXAMPLES[0]);
  let shownPrompt = $state("");
  let selected = $state(0);
  let ms = $state(0);
  let copied = $state(false);
  let codeCopied = $state(false);
  let outlineEnabled = $state(false);
  let sprites = $state<(ImageData | null)[]>(Array(VARIANTS).fill(null));
  let made = $state(0);
  let step = $state(0);
  let round = $state(1);
  let stopRequested = $state(false);
  const STEPS = 16;

  let engine: any = $state(null);
  let seed = 1;

  const mb = (b: number) => Math.round(b / 1e6);

  // Draw a 16x16 sprite onto a canvas with crisp pixels.
  function paint(canvas: HTMLCanvasElement | undefined, img: ImageData | null) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    const s = canvas.width / GRID;
    for (let i = 0; i < N; i++) {
      const a = img.data[i * 4 + 3];
      if (!a) continue;
      ctx.fillStyle = `rgba(${img.data[i * 4]},${img.data[i * 4 + 1]},${img.data[i * 4 + 2]},${a / 255})`;
      ctx.fillRect((i % GRID) * s, Math.floor(i / GRID) * s, Math.ceil(s), Math.ceil(s));
    }
  }

  function pixelAction(canvas: HTMLCanvasElement, img: ImageData | null) {
    paint(canvas, img);
    return { update: (next: ImageData | null) => paint(canvas, next) };
  }

  async function run(text = prompt) {
    const clean = text.trim();
    if (!engine || !clean || status === "working") return;
    prompt = clean;
    status = "working";
    copied = false;
    stopRequested = false;
    const t0 = performance.now();
    // The GPU makes all 4 in one batch (~1 s). The CPU makes them one after another (~10 s each),
    // so the first shows up quickly and the rest fill in while you look.
    const perRun = engine.device === "webgpu" ? VARIANTS : 1;
    const rounds = VARIANTS / perRun;
    const done: ImageData[] = [];
    const empty = () => Array(VARIANTS).fill(null);
    made = 0;
    selected = 0;
    try {
      for (let r = 0; r < rounds && !stopRequested; r++) {
        round = r + 1;
        step = 0;
        seed = (seed * 7919 + 17) % 2147483647;
        const toImages = (x: Int32Array, masked: Uint8Array | null) =>
          Array.from({ length: perRun }, (_, b) => new ImageData(engine.toRGBA(x, masked, b), GRID, GRID));
        const x = await engine.generate(clean, {
          n: perRun,
          seed,
          onStep: (k: number, x: Int32Array, masked: Uint8Array) => {
            step = k + 1;
            sprites = [...done, ...toImages(x, masked), ...empty()].slice(0, VARIANTS);
          },
        });
        done.push(...toImages(x, null));
        sprites = [...done, ...empty()].slice(0, VARIANTS);
        made = done.length;
        shownPrompt = clean;
      }
      ms = Math.round(performance.now() - t0);
      status = "ready";
    } catch (e: any) {
      errorText = e?.message ?? String(e);
      status = "error";
    }
  }

  function pngBlob(img: ImageData, size = 128): Promise<Blob> {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    paint(c, img);
    return new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
  }

  function slug(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "emoji";
  }

  async function download() {
    const img = current;
    if (!img) return;
    const url = URL.createObjectURL(await pngBlob(img));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(shownPrompt)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(shortcode);
      codeCopied = true;
      setTimeout(() => (codeCopied = false), 1400);
    } catch {
      // Clipboard can be blocked in some iframes; the code is still visible to select.
    }
  }

  async function copy() {
    const img = current;
    if (!img) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob(img) })]);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      download();
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    if (status === "working") stopRequested = true;
    else run();
  }

  // Pre-made emoji (real Tessera output) so every example shows instantly, even before the model loads.
  function loadImageData(src: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = GRID;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, GRID, GRID);
        resolve(ctx.getImageData(0, 0, GRID, GRID));
      };
      img.onerror = () => reject(new Error(`Couldn't load ${src}`));
      img.src = src;
    });
  }

  async function showExample(text: string) {
    prompt = text;
    try {
      sprites = await Promise.all(Array.from({ length: VARIANTS }, (_, i) => loadImageData(`examples/${slug(text)}-${i}.png`)));
      shownPrompt = text;
      selected = 0;
      made = VARIANTS;
      ms = 0;
    } catch {
      // The example images are optional decoration; the live model still works without them.
    }
  }

  function pickExample(text: string) {
    if (engine && status === "ready") run(text);
    else showExample(text);
  }

  async function startLoading() {
    status = "loading";
    loadStage = "download";
    try {
      engine = await loadEngine((p: { stage: LoadStage; loaded: number; total: number }) => {
        loadStage = p.stage;
        loaded = p.loaded;
        total = p.total;
      });
      status = "ready";
      await tick();
    } catch (e: any) {
      errorText = e?.message ?? String(e);
      status = "error";
    }
  }

  onMount(async () => {
    loadImageData("examples/rubber-duck-0.png").then((img) => (loaderSprite = img), () => {});
    await showExample(EXAMPLES[0]);
    // If the last visit was killed mid-load, retrying on our own just crashes again in a loop.
    if (crashedLastTime()) {
      status = "crashed";
      return;
    }
    await startLoading();
  });

  const UNPAINTED = [228, 228, 233, 255];
  // The loader sprite with only the first `frac` of its pixels painted, in reading order.
  // Unpainted pixels show as a grey silhouette, so it fills in on its own shape.
  function partialSprite(img: ImageData, frac: number): ImageData {
    const out = new ImageData(new Uint8ClampedArray(img.data), GRID, GRID);
    const painted = Math.round(frac * N);
    for (let i = painted; i < N; i++) {
      if (out.data[i * 4 + 3]) out.data.set(UNPAINTED, i * 4);
    }
    return out;
  }

  let displayed = $derived(sprites.map((sprite, i) =>
    outlineEnabled && sprite && i < made
      ? new ImageData(repairOutline(sprite.data, GRID, GRID), GRID, GRID)
      : sprite,
  ));
  let current = $derived(displayed[selected]);
  // While painting, label the emoji being made; otherwise the one on screen.
  let activePrompt = $derived(status === "working" ? prompt : shownPrompt || prompt);
  let shortcode = $derived(`:${slug(activePrompt)}:`);
  let busy = $derived(status === "working");
  let canMake = $derived(!!engine && status === "ready");
  let showLoader = $derived(status === "loading" || status === "crashed" || (status === "error" && !engine));
  let downloadFrac = $derived(total ? Math.min(1, loaded / total) : 0);
  let loaderImage = $derived(loaderSprite && partialSprite(loaderSprite, status !== "loading" ? 0 : loadStage === "download" ? downloadFrac : 1));
  let loaderTitle = $derived(
    status === "crashed"
      ? "The page closed while loading the model"
      : status === "error"
        ? "Couldn't load the model"
        : loadStage === "download"
          ? `Downloading the model · ${Math.round(downloadFrac * 100)}%`
          : loadStage === "load"
            ? "Loading the model…"
            : "Testing your GPU…",
  );
  let loaderDetail = $derived(
    status === "crashed"
      ? "Your browser probably ran out of memory. Close other tabs, or open this page in your main browser instead of an in-app one, then try again."
      : status === "error"
        ? errorText
        : loadStage === "download"
          ? `${mb(loaded)} / ${mb(total)} MB · first visit only`
          : loadStage === "load"
            ? "Almost there"
            : "Making sure it paints correctly",
  );
</script>

<main>
  <h1>Emoji Studio</h1>
  <p class="sub">Turn a short description into a pixel emoji, right in your browser.</p>

  <form class="input" onsubmit={submit}>
    <input
      bind:value={prompt}
      placeholder="Describe an emoji"
      aria-label="Describe an emoji"
      maxlength="120"
      autocomplete="off"
      spellcheck="false"
    />
    <button class="go" type="submit" disabled={status === "working" ? engine?.device !== "cpu" || stopRequested : !canMake || !prompt.trim()} aria-label={status === "working" ? "Stop" : "Make emoji"}>
      {#if status === "working" && engine?.device === "cpu"}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" /></svg>
      {:else if status === "working"}
        <svg class="spin" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="40 100" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4.5 12h14.5M13 5.5l6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>
      {/if}
    </button>
  </form>

  {#if showLoader}
    <div class="loader card" role="status" aria-live="polite">
      {#if loaderImage}<canvas width="128" height="128" class:bob={status === "loading" && loadStage !== "download"} use:pixelAction={loaderImage}></canvas>{/if}
      <b>{loaderTitle}</b>
      <span class="muted small">{loaderDetail}</span>
      {#if status !== "loading"}
        <button class="chip dark" onclick={startLoading}>Try again</button>
      {/if}
    </div>
  {/if}

  <div class="chips">
    {#each EXAMPLES as ex (ex)}
      <button class="chip ex" class:on={ex === activePrompt} aria-pressed={ex === activePrompt} disabled={busy} onclick={() => pickExample(ex)}>
        <img class="ico" src="examples/{slug(ex)}-0.png" alt="" width="22" height="22" />
        {ex}
      </button>
    {/each}
  </div>

  <section class="stage">
    <div class="left">
      <div class="big card">
        {#if current}<canvas width="256" height="256" use:pixelAction={current}></canvas>{/if}
      </div>
      <button class="code" onclick={copyCode} title="Copy the emoji name">{codeCopied ? "Copied" : shortcode}</button>
    </div>

    <div class="chat card">
      <div class="msg">
        <img class="avatar" src="avatar.png" alt="" width="44" height="44" />
        <div class="body">
          <div><b>you</b> <span class="muted small">now</span></div>
          <div class="line">
            shipped it
            {#if current}<canvas class="inline" width="64" height="64" use:pixelAction={current}></canvas>{/if}
          </div>
          {#if current}
            <div class="reactions">
              <span class="reaction mine"><canvas width="32" height="32" use:pixelAction={current}></canvas>3</span>
              <span class="reaction"><span class="uni">🎉</span>2</span>
              <span class="reaction"><span class="uni">🙌</span>1</span>
              <span class="reaction add" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8" /><circle cx="9.2" cy="10.2" r="1.1" fill="currentColor" /><circle cx="14.8" cy="10.2" r="1.1" fill="currentColor" /><path d="M8.8 14c.8 1.1 1.9 1.7 3.2 1.7s2.4-.6 3.2-1.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
              </span>
            </div>
          {/if}
        </div>
      </div>

      <div class="picks">
        {#each displayed as s, i (i)}
          <button class="pick" class:on={i === selected} class:empty={!s} disabled={!s || i >= made} onclick={() => (selected = i)} aria-label="Variation {i + 1}" aria-pressed={i === selected}>
            <canvas width="64" height="64" use:pixelAction={s}></canvas>
          </button>
        {/each}
      </div>

      <label class="outline-option">
        <input type="checkbox" bind:checked={outlineEnabled} />
        <span>Repair outline</span>
      </label>

      <div class="actions">
        <button class="chip dark" disabled={!current || selected >= made} onclick={download}>Download PNG</button>
        <button class="chip" disabled={!current || selected >= made} onclick={copy}>{copied ? "Copied" : "Copy"}</button>
        <button class="chip" disabled={!canMake} onclick={() => run(shownPrompt || prompt)}>Try again</button>
      </div>
      <div class="muted small meta">
        {#if status === "loading"}
          <span>Getting the model ready…</span>
        {:else if status === "working"}
          <div class="bar"><i style="width:{(((round - 1) * STEPS + step) / ((engine?.device === "cpu" ? VARIANTS : 1) * STEPS)) * 100}%"></i></div>
          <span>
            {engine?.device === "cpu" ? `Emoji ${round} of ${VARIANTS} · ` : ""}{#if step === 0}Reading your prompt…{:else}Painting · step {step} of {STEPS}{/if}{engine?.device === "cpu" ? (stopRequested ? " · stopping after this one" : " · on your CPU, about 10 s each") : ""}
          </span>
        {:else if status === "error"}
          <span class="err">Something went wrong: {errorText}</span>
        {:else if ms}
          {made} emoji in {(ms / 1000).toFixed(1)} s, on your {engine?.device === "webgpu" ? "GPU" : "CPU"}
        {:else}
          Ready. Type anything.{CPU_NOTES[engine?.fallbackReason] ?? ""}
        {/if}
      </div>
    </div>
  </section>
</main>

<footer>
  <a class="source" href="https://huggingface.co/spaces/cfahlgren1/slack-moji" target="_blank" rel="noopener">
    <img src="hf.svg" alt="" width="22" height="22" />
    Original Slack Moji on Hugging Face
  </a>
  <a href="https://huggingface.co/thejagstudio/tessera-small" target="_blank" rel="noopener">Tessera-small by Jagrat Patel</a>
  <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener">CC BY-NC 4.0</a>
  <a href="https://github.com/FireTable/emoji" target="_blank" rel="noopener">Source code</a>
</footer>

<style>
  :global(:root) {
    --bg: #faf8f4;
    --ink: #1d1b28;
    --muted: #625e70;
    --accent: #4c37c7;
    --tint: #f0ecff;
    --line: #e6e1ed;
  }
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  :global(:where(a[href], button, input):focus-visible) {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 10px 24px;
    width: min(900px, calc(100% - 32px));
    margin: 0 auto;
    padding: 22px 0 34px;
    border-top: 1px solid var(--line);
    font-size: 13px;
    line-height: 1.5;
  }
  footer a {
    color: var(--muted);
    text-underline-offset: 3px;
  }
  .source {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  main {
    max-width: 1080px;
    margin: 0 auto;
    padding: clamp(56px, 9vw, 108px) 20px 62px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  h1 {
    margin: 0;
    font: 800 clamp(42px, 7vw, 76px) / 1.03 Inter, sans-serif;
    letter-spacing: -0.065em;
    text-align: center;
  }
  .sub {
    margin: 14px 0 0;
    font: 500 clamp(17px, 2vw, 21px) / 1.4 Inter, sans-serif;
    color: var(--muted);
    text-align: center;
  }
  .left {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: min(320px, 100%);
  }
  .code {
    max-width: 100%;
    min-height: 38px;
    padding: 0 16px;
    border: 0;
    border-radius: 19px;
    background: var(--tint);
    color: var(--accent);
    font: 600 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  @media (hover: hover) {
    .code:hover {
      background: #e7dfff;
    }
  }
  .reactions {
    margin-top: 8px;
    display: flex;
    gap: 6px;
  }
  .reaction {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 9px 0 6px;
    border-radius: 13px;
    background: #f2f2f4;
    font: 600 13px/1 Inter, sans-serif;
    color: #1d1d1f;
  }
  .reaction canvas {
    width: 18px;
    height: 18px;
    image-rendering: pixelated;
  }
  .uni {
    font-size: 15px;
    line-height: 1;
  }
  .reaction.mine {
    background: #e8f2fb;
    box-shadow: inset 0 0 0 1px #1d74c9;
    color: #1d5fa8;
  }
  .reaction.add {
    padding: 0 8px;
    color: #8e8e93;
  }
  .input {
    margin-top: 32px;
    width: min(760px, 100%);
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 68px;
    padding: 0 10px 0 28px;
    border: 1px solid var(--line);
    border-radius: 24px;
    background: #fff;
    box-shadow: 0 8px 28px #3222690e;
  }
  .input input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font: 500 22px/1.2 Inter, sans-serif;
    color: var(--ink);
  }
  .go {
    flex: none;
    width: 50px;
    height: 50px;
    border: 0;
    border-radius: 25px;
    background: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: transform 0.15s ease, opacity 0.15s ease;
  }
  @media (hover: hover) {
    .go:not(:disabled):hover {
      transform: scale(1.06);
    }
  }
  .go:not(:disabled):active {
    transform: scale(0.94);
  }
  .go:disabled {
    background: #c7c7cc;
    cursor: default;
  }
  .spin {
    animation: spin 0.8s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .spin { animation: none; }
    .go, .bar i { transition: none; }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .chips {
    margin-top: 18px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .chip {
    min-height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: 20px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 3px 12px rgba(0, 0, 0, 0.05);
    font: 600 15px/1 Inter, sans-serif;
    color: var(--ink);
    cursor: pointer;
    white-space: nowrap;
  }
  .chip.on {
    background: var(--tint);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .chip.dark {
    background: var(--accent);
    color: #fff;
  }
  .chip:disabled {
    opacity: 0.45;
    cursor: default;
  }
  @media (hover: hover) {
    .chip:not(:disabled):hover {
      transform: translateY(-1px);
    }
  }
  .stage {
    margin-top: 44px;
    display: flex;
    flex-wrap: wrap;
    gap: 32px;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
  .card {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 24px;
    box-shadow: 0 8px 28px #3222690e;
  }
  .big {
    width: 100%;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    background-color: #fff;
    background-image: conic-gradient(#f2edf9 25%, #fff 0 50%, #f2edf9 0 75%, #fff 0);
    background-size: 28px 28px;
  }
  .big canvas {
    width: 80%;
    height: 80%;
    image-rendering: pixelated;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: #ececf0;
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .loader {
    margin-top: 22px;
    width: min(320px, 100%);
    padding: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }
  .loader canvas {
    width: 128px;
    height: 128px;
    margin-bottom: 6px;
  }
  .loader b {
    font-size: 17px;
    overflow-wrap: anywhere;
  }
  .loader .muted {
    overflow-wrap: anywhere;
  }
  .loader .chip {
    margin-top: 6px;
  }
  @media (prefers-reduced-motion: no-preference) {
    .bob {
      animation: bob 1s ease-in-out infinite alternate;
    }
  }
  @keyframes bob {
    to {
      transform: translateY(-6px);
    }
  }
  .err {
    overflow-wrap: anywhere;
    font-weight: 500;
    font-size: 14px;
  }
  .chat {
    width: min(540px, 100%);
    padding: 26px 28px;
  }
  .msg {
    display: flex;
    gap: 14px;
  }
  .avatar {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    padding: 3px;
    image-rendering: pixelated;
    background: #e8e8ed;
  }
  .body {
    min-width: 0;
    font: 400 20px/1.5 Inter, sans-serif;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .inline {
    width: 28px;
    height: 28px;
    image-rendering: pixelated;
  }
  .picks {
    margin-top: 22px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .pick {
    width: 68px;
    height: 68px;
    padding: 6px;
    border: 0;
    border-radius: 14px;
    background: #f5f5f7;
    cursor: pointer;
  }
  .pick.empty {
    opacity: 0.5;
  }
  .pick.on {
    background: var(--tint);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .pick canvas {
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }
  .outline-option {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    margin-top: 12px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .outline-option input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--accent);
  }
  .actions {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 14px;
  }
  .meta {
    margin: 16px 0 0;
    min-height: 36px;
    line-height: 1.4;
  }
  .meta .bar {
    margin-bottom: 8px;
  }
  .chip.ex {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding-left: 10px;
  }
  .ico {
    image-rendering: pixelated;
    flex: none;
  }
  @media (max-width: 640px) {
    main {
      padding: 52px 16px 48px;
    }
    .input {
      padding-left: 20px;
    }
    .input input {
      font-size: 18px;
    }
    .chat {
      padding: 20px;
    }
  }
</style>
