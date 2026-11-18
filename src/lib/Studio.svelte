<script lang="ts">
  import { onMount, tick } from "svelte";
  import { APP_NAME, REPO_NAME, REPO_URL } from "$lib/brand";
  import { loadEngine, previousLoad, GRID, N, FILES } from "$lib/client.js";
  import { LOCALES, type Locale } from "$lib/i18n";
  import { readHistory, saveGeneration, type HistoryEntry } from "$lib/history";
  import OutlineCompare from "$lib/OutlineCompare.svelte";
  import Seo from "$lib/Seo.svelte";
  import StudioToolbar from "$lib/StudioToolbar.svelte";
  import HistoryDrawer from "$lib/HistoryDrawer.svelte";
  import PixelDecorations from "$lib/PixelDecorations.svelte";
  import { dismissOnBackdrop } from "$lib/dismissOnBackdrop";

  let { locale }: { locale: Locale } = $props();
  const words = $derived(LOCALES[locale]);
  const THEME_KEY = "emoji-studio:theme";
  const HISTORY_BATCH = 16;
  type Theme = "system" | "light" | "dark";
  import { repairOutline } from "$lib/outline.js";

  const EXAMPLES = ["cat wearing sunglasses", "slice of pizza", "ghost", "taco", "fire", "rubber duck", "energy drink"];
  const VARIANTS = 4;
  type Status = "loading" | "crashed" | "ready" | "working" | "error";
  type LoadStage = "download" | "load" | "check";

  let status = $state<Status>("loading");
  let recovery = $state(false);
  let theme = $state<Theme>("system");
  let loadDialog = $state<HTMLDialogElement>();
  let historyDrawer: { show(): void } | undefined = $state();
  let aboutDialog = $state<HTMLDialogElement>();
  let history = $state<HistoryEntry[]>([]);
  let historyLimit = $state(HISTORY_BATCH);
  let historyHasMore = $state(false);
  let historyError = $state(false);
  let errorText = $state("");
  let loaded = $state(0);
  let total = $state(FILES.reduce((sum, f) => sum + f.bytes, 0));
  let loadStage = $state<LoadStage>("download");
  // The loader paints this sprite in, pixel by pixel, as the model downloads.
  let loaderSprite = $state<ImageData | null>(null);
  let prompt = $state(EXAMPLES[0]);
  let shownPrompt = $state(EXAMPLES[0]);
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
  const MOBILE_PREVIEW_INTERVAL = 120;

  let engine: any = $state(null);
  let seed = 1;

  const mb = (b: number) => Math.round(b / 1e6);
  const initialSprite = (index: number) => `/examples/${slug(EXAMPLES[0])}-${index}.png`;

  let spriteContext: CanvasRenderingContext2D | undefined;
  function paint(canvas: HTMLCanvasElement | undefined, img: ImageData | null) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    if (!spriteContext) {
      const source = document.createElement("canvas");
      source.width = source.height = GRID;
      spriteContext = source.getContext("2d")!;
    }
    spriteContext.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spriteContext.canvas, 0, 0, canvas.width, canvas.height);
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
    const previewInterval = matchMedia("(max-width: 720px)").matches ? MOBILE_PREVIEW_INTERVAL : undefined;
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
          previewInterval,
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
      if (done.length) void rememberGeneration(clean, done);
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
      sprites = await Promise.all(Array.from({ length: VARIANTS }, (_, i) => loadImageData(`/examples/${slug(text)}-${i}.png`)));
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

  async function startLoading(lowMemory = false) {
    recovery = lowMemory;
    status = "loading";
    loaded = 0;
    loadStage = "download";
    try {
      engine = await loadEngine((p: { stage: LoadStage; loaded: number; total: number }) => {
        loadStage = p.stage;
        loaded = p.loaded;
        total = p.total;
      }, { recovery: lowMemory });
      status = "ready";
      await tick();
    } catch (e: any) {
      errorText = e?.message ?? String(e);
      status = "error";
    }
  }

  async function reloadHistory() {
    try {
      const entries = await readHistory(historyLimit + 1);
      historyHasMore = entries.length > historyLimit;
      history = entries.slice(0, historyLimit);
      historyError = false;
    } catch {
      historyError = true;
    }
  }

  async function rememberGeneration(text: string, images: ImageData[]) {
    try {
      await saveGeneration({
        prompt: text,
        createdAt: Date.now(),
        pixels: images.map((image) => new Uint8ClampedArray(image.data)),
      });
      await reloadHistory();
    } catch {
      historyError = true;
    }
  }

  function showOlder() {
    historyLimit += HISTORY_BATCH;
    void reloadHistory();
  }

  function closeAbout() {
    aboutDialog?.close();
  }

  function applyTheme(value: string | null, persist = false) {
    theme = value === "light" || value === "dark" ? value : "system";
    document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content =
      theme === "system" ? "light dark" : theme;
    if (!persist) return;
    try {
      if (theme === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }

  onMount(() => {
    applyTheme(document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content);
    const syncTheme = (event: StorageEvent) => {
      if (event.key === THEME_KEY) applyTheme(event.newValue);
    };
    window.addEventListener("storage", syncTheme);
    void reloadHistory();
    loadImageData("/examples/rubber-duck-0.png").then((img) => (loaderSprite = img), () => {});
    void (async () => {
      await showExample(EXAMPLES[0]);
      const previous = previousLoad();
      if (previous === "recovery") {
        status = "crashed";
        return;
      }
      await startLoading(previous === "standard");
    })();
    return () => window.removeEventListener("storage", syncTheme);
  });

  $effect(() => {
    document.documentElement.lang = words.lang;
  });

  $effect(() => {
    if (!loadDialog) return;
    if (showLoader && !loadDialog.open) loadDialog.showModal();
    if (!showLoader && loadDialog.open) loadDialog.close();
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
  let loadFailed = $derived(status === "crashed" || (status === "error" && !engine));
  let showLoader = $derived(status === "loading" || loadFailed);
  let downloadFrac = $derived(total ? Math.min(1, loaded / total) : 0);
  let loaderImage = $derived(loaderSprite && partialSprite(loaderSprite, loadFailed ? 0 : loadStage === "download" ? downloadFrac : 1));
  let loaderTitle = $derived(
    status === "crashed" ? words.closed
      : status === "error" ? words.loadError
      : loadStage === "download" ? words.downloading(Math.round(downloadFrac * 100))
      : loadStage === "load" ? words.loading
      : words.testingGpu,
  );
  let loaderDetail = $derived(
    status === "crashed" ? words.memory
      : status === "error" ? errorText
      : loadStage === "download" ? words.bytes(mb(loaded), mb(total))
      : loadStage === "load" ? (recovery ? words.recovering : "")
      : words.gpuCheck,
  );
</script>

<Seo {locale} />

<div class="site">
<PixelDecorations />
<StudioToolbar
  {locale}
  {theme}
  onTheme={(value) => applyTheme(value, true)}
  onHistory={() => historyDrawer?.show()}
  onAbout={() => aboutDialog?.showModal()}
/>
<main>
  <h1>{APP_NAME}</h1>
  <p class="sub">{words.subtitle}</p>

  <form class="input" onsubmit={submit}>
    <input
      bind:value={prompt}
      placeholder={words.prompt}
      aria-label={words.prompt}
      maxlength="120"
      autocomplete="off"
      spellcheck="false"
    />
    <button class="go" type="submit" disabled={status === "working" ? engine?.device !== "cpu" || stopRequested : !canMake || !prompt.trim()} aria-label={status === "working" ? words.stop : words.make}>
      {#if status === "working" && engine?.device === "cpu"}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" /></svg>
      {:else if status === "working"}
        <svg class="spin" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="40 100" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4.5 12h14.5M13 5.5l6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>
      {/if}
    </button>
  </form>

  <div class="chips">
    {#each EXAMPLES as ex, i (ex)}
      <button class="chip ex" class:on={ex === activePrompt} aria-pressed={ex === activePrompt} disabled={busy} onclick={() => pickExample(ex)}>
        <img class="ico" src="/examples/{slug(ex)}-0.png" alt="" width="22" height="22" />
        {words.examples[i]}
      </button>
    {/each}
  </div>

  <section class="stage">
    <div class="left card">
      <div class="big">
        {#if current && outlineEnabled && selected < made && sprites[selected]}
          <OutlineCompare before={sprites[selected]!} after={current} beforeLabel={words.before} afterLabel={words.after} label={words.compare} />
        {:else if current}
          <canvas width="256" height="256" use:pixelAction={current}></canvas>
        {:else}
          <img src={initialSprite(0)} alt="" width="256" height="256" />
        {/if}
      </div>
    </div>

    <div class="chat card">
      <div class="msg">
        <img class="avatar" src="/avatar.png" alt="" width="44" height="44" />
        <div class="body">
          <div><b>{words.you}</b> <span class="muted small">{words.now}</span></div>
          <div class="line">
            {words.message}
            {#if current}
              <canvas class="inline" width="64" height="64" use:pixelAction={current}></canvas>
            {:else}
              <img class="inline" src={initialSprite(0)} alt="" width="64" height="64" />
            {/if}
          </div>
          <div class="reactions">
            <span class="reaction mine">
              {#if current}
                <canvas width="32" height="32" use:pixelAction={current}></canvas>
              {:else}
                <img src={initialSprite(0)} alt="" width="32" height="32" />
              {/if}
              3
            </span>
            <span class="reaction"><span class="uni">🎉</span>2</span>
            <span class="reaction"><span class="uni">🙌</span>1</span>
            <span class="reaction add" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8" /><circle cx="9.2" cy="10.2" r="1.1" fill="currentColor" /><circle cx="14.8" cy="10.2" r="1.1" fill="currentColor" /><path d="M8.8 14c.8 1.1 1.9 1.7 3.2 1.7s2.4-.6 3.2-1.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
            </span>
          </div>
        </div>
      </div>

      <div class="picks">
        {#each displayed as s, i (i)}
          <button class="pick" class:on={i === selected} class:empty={!s && (status === "working" || !!made)} disabled={!s || i >= made} onclick={() => (selected = i)} aria-label={words.variation(i + 1)} aria-pressed={i === selected}>
            {#if s || status === "working" || made}
              <canvas width="64" height="64" use:pixelAction={s}></canvas>
            {:else}
              <img src={initialSprite(i)} alt="" width="64" height="64" />
            {/if}
          </button>
        {/each}
      </div>

      <label class="outline-option">
        <input type="checkbox" bind:checked={outlineEnabled} />
        <span>{words.repair}</span>
      </label>

      <div class="actions">
        <button class="chip dark" disabled={!current || selected >= made} onclick={download}>{words.download}</button>
        <button class="chip" disabled={!current || selected >= made} onclick={copy}>{copied ? words.copied : words.copy}</button>
        <button class="chip" disabled={!canMake} onclick={() => run(shownPrompt || prompt)}>{words.again}</button>
      </div>
      <div class="card-foot">
        <div class="muted small meta">
          {#if showLoader}
            <span>{loaderTitle}</span>
          {:else if status === "working"}
            <div class="bar"><i style:transform={`scaleX(${((round - 1) * STEPS + step) / ((engine?.device === "cpu" ? VARIANTS : 1) * STEPS)})`}></i></div>
            <span>
              {engine?.device === "cpu" ? words.progress(round, VARIANTS) : ""}{step === 0 ? words.reading : words.painting(step)}{engine?.device === "cpu" ? (stopRequested ? words.stopping : words.cpuProgress) : ""}
            </span>
          {:else if status === "error"}
            <span class="err">{words.error} · {errorText}</span>
          {:else if ms}
            {words.done(made, (ms / 1000).toFixed(1), engine?.device === "webgpu")}
          {:else}
            {words.ready}{words.cpuNotes[engine?.fallbackReason as keyof typeof words.cpuNotes] ?? ""}
          {/if}
        </div>
        <button class="code" onclick={copyCode} title={words.copyName}>{codeCopied ? words.copied : shortcode}</button>
      </div>
    </div>
  </section>
</main>

<footer>
  <a class="source" href="https://huggingface.co/spaces/cfahlgren1/slack-moji" target="_blank" rel="noopener">
    <span class="footer-icon"><img src="/hf.svg" alt="" width="23" height="23" /></span>
    {words.original}
  </a>
  <a href="https://huggingface.co/thejagstudio/tessera-small" target="_blank" rel="noopener">{words.model}</a>
  <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener">CC BY-NC 4.0</a>
  <a class="source" href={REPO_URL} target="_blank" rel="noopener">
    {REPO_NAME}
    <span class="footer-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943"/></svg></span>
  </a>
</footer>
</div>

<HistoryDrawer bind:this={historyDrawer} {locale} entries={history} hasMore={historyHasMore} error={historyError} onMore={showOlder} />

<dialog class="about-drawer" bind:this={aboutDialog} aria-labelledby="about-title" closedby="any" use:dismissOnBackdrop={closeAbout}>
  <div class="drawer-header">
    <h2 id="about-title">{words.about}</h2>
    <button class="drawer-close" onclick={closeAbout} aria-label={locale === "zh" ? "关闭" : "Close"}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </button>
  </div>
  <div class="drawer-body">
    <section>
      <h3>{words.aboutOriginal.title}</h3>
      <p>{words.aboutOriginal.app}</p>
      <p>{words.aboutOriginal.model}</p>
      <ul class="about-links">
        <li><a href="https://huggingface.co/spaces/cfahlgren1/slack-moji" target="_blank" rel="noopener">{words.original}</a></li>
        <li><a href="https://huggingface.co/thejagstudio/tessera-small" target="_blank" rel="noopener">{words.model}</a></li>
      </ul>
    </section>
    <section>
      <h3>{words.aboutChanges.title}</h3>
      <ul class="about-changes">
        {#each words.aboutChanges.items as item (item.title)}
          <li>
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </li>
        {/each}
      </ul>
    </section>
    <section>
      <h3>{words.aboutLocal.title}</h3>
      <p>{words.aboutLocal.device}</p>
    </section>
  </div>
</dialog>

<dialog class="load-dialog" bind:this={loadDialog} aria-labelledby="load-title">
  <div class="load-art">
    {#if loaderImage}
      <canvas width="128" height="128" class:bob={status === "loading" && loadStage !== "download"} use:pixelAction={loaderImage} aria-hidden="true"></canvas>
    {/if}
  </div>
  <div class="load-status" role="status">
    <p id="load-title">{loaderTitle}</p>
    {#if loaderDetail}<p class="muted small">{loaderDetail}</p>{/if}
  </div>
  {#if loadFailed}
    <button class="chip dark" onclick={() => startLoading(true)}>{words.retry}</button>
  {:else if status === "loading" && loadStage === "download"}
    <progress value={loaded} max={total} aria-label={loaderTitle}></progress>
  {/if}
</dialog>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  @supports (scrollbar-gutter: stable) {
    :global(html) { scrollbar-gutter: stable; }
    :global(html:has(.load-dialog:modal)) { overflow: hidden; }
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  :global(:where(a[href], button, input, select, summary):focus-visible) {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }
  .site {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    min-height: 100svh;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 10px 24px;
    width: min(900px, calc(100% - 32px));
    margin: auto auto 0;
    padding: 16px 0 max(24px, env(safe-area-inset-bottom));
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
  .footer-icon {
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    display: inline-grid;
    place-items: center;
  }
  .footer-icon img, .footer-icon svg { display: block; }
  .footer-icon svg { transform: translateY(-1px); }

  main {
    width: 100%;
    max-width: 1080px;
    margin: 0 auto;
    padding: clamp(30px, 5vw, 74px) 20px 48px;
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
    padding: 18px;
    justify-content: center;
  }
  .code {
    max-width: min(100%, 180px);
    min-height: 34px;
    padding: 0 12px;
    border: 0;
    border-radius: 10px;
    background: var(--tint);
    color: var(--accent);
    font: 600 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  @media (hover: hover) {
    .code:hover {
      background: var(--soft);
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
    background: var(--soft);
    font: 600 13px/1 Inter, sans-serif;
    color: var(--ink);
  }
  .reaction canvas, .reaction img {
    width: 18px;
    height: 18px;
    image-rendering: pixelated;
  }
  .uni {
    font-size: 15px;
    line-height: 1;
  }
  .reaction.mine {
    background: var(--reaction);
    box-shadow: inset 0 0 0 1px var(--reaction-line);
    color: var(--reaction-text);
  }
  .reaction.add {
    padding: 0 8px;
    color: var(--muted);
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
    background: var(--surface);
    box-shadow: 0 8px 28px var(--shadow);
  }
  .input input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font: 500 22px/1.2 Inter, sans-serif;
    color: var(--ink);
  }
  @supports selector(.input:has(> input:focus-visible)) {
    .input:has(> input:focus-visible) {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .input > input:focus-visible {
      outline: none;
    }
  }
  .go {
    flex: none;
    width: 50px;
    height: 50px;
    border: 0;
    border-radius: 25px;
    background: var(--accent);
    color: var(--on-accent);
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
    background: var(--disabled);
    cursor: default;
  }
  .spin {
    animation: spin 0.8s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .spin { animation: none; }
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
    background: var(--surface);
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
    color: var(--on-accent);
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
    margin-top: 34px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
    align-items: stretch;
    width: min(880px, 100%);
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 24px;
    box-shadow: 0 8px 28px var(--shadow);
  }
  .big {
    position: relative;
    width: min(100%, 340px);
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border-radius: 18px;
    overflow: hidden;
    background-color: var(--surface);
    background-image: conic-gradient(var(--checker) 25%, var(--surface) 0 50%, var(--checker) 0 75%, var(--surface) 0);
    background-size: 28px 28px;
  }
  .big > canvas, .big > img {
    width: 80%;
    height: 80%;
    image-rendering: pixelated;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--soft);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
    transform-origin: left center;
    transition: transform 0.2s;
  }
  .load-dialog {
    width: min(350px, calc(100% - 32px));
    height: 268px;
    max-height: calc(100% - 32px);
    border: 1px solid var(--line);
    border-radius: 24px;
    padding: 24px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 20px 80px #15102044;
    text-align: center;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    justify-content: safe center;
    gap: 12px;
    opacity: 0;
    transform: translateY(8px) scale(.98);
    transition: opacity 180ms, transform 220ms ease-out, display 220ms allow-discrete, overlay 220ms allow-discrete;
  }
  .load-dialog[open] {
    display: flex;
    opacity: 1;
    transform: none;
  }
  .load-dialog:modal { overscroll-behavior: contain; }
  @supports (backdrop-filter: blur(1px)) {
    .load-dialog {
      background:
        radial-gradient(ellipse at 15% 0%, #fff2, transparent 58%),
        linear-gradient(150deg, color-mix(in srgb, var(--surface) 69%, transparent), color-mix(in srgb, var(--surface) 51%, transparent));
      border-color: #fff5;
      backdrop-filter: blur(13px) saturate(145%);
      box-shadow: 0 20px 68px #1510204d, inset 0 1px 1px #fff8, inset 0 -1px 1px #fff2;
    }
    .load-dialog .muted {
      color: color-mix(in srgb, var(--ink) 76%, var(--muted));
    }
    @media (prefers-reduced-transparency: reduce), (forced-colors: active) {
      .load-dialog {
        background: var(--surface);
        backdrop-filter: none;
        border-color: var(--line);
      }
    }
  }
  .load-dialog:focus { outline: none; }
  .load-dialog::backdrop, .about-drawer::backdrop {
    opacity: 0;
    transition: opacity 220ms, display 220ms allow-discrete, overlay 220ms allow-discrete;
  }
  .load-dialog::backdrop {
    background: #19122457;
    overflow: hidden;
    overscroll-behavior: contain;
  }
  .about-drawer::backdrop {
    background: #19122470;
    backdrop-filter: blur(6px);
  }
  .load-dialog[open]::backdrop, .about-drawer[open]::backdrop { opacity: 1; }
  .load-art { flex: 0 0 80px; }
  .load-dialog canvas { display: block; width: 80px; height: 80px; image-rendering: pixelated; }
  .load-status { display: grid; gap: 4px; min-height: 0; }
  .load-status p {
    margin: 0;
    overflow: auto;
    overflow-wrap: anywhere;
    line-height: 1.4;
  }
  #load-title { align-content: center; font-size: 17px; font-weight: 700; }
  .load-dialog progress { flex: 0 0 8px; width: min(220px, 100%); accent-color: var(--accent); }
  .about-drawer {
    position: fixed;
    inset: 0 0 0 auto;
    width: min(430px, 100%);
    max-width: none;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: var(--surface);
    color: var(--ink);
    grid-template-rows: auto minmax(0, 1fr);
    opacity: 0;
    transform: translateX(24px);
    transition: opacity 180ms ease, transform 240ms cubic-bezier(.2,.75,.25,1), display 240ms allow-discrete, overlay 240ms allow-discrete;
  }
  .about-drawer[open] { display: grid; opacity: 1; transform: none; }
  .drawer-header { display: flex; justify-content: space-between; align-items: center; padding: 22px 24px 16px; gap: 12px; }
  .drawer-header h2 { margin: 0; font-size: 21px; letter-spacing: -.025em; }
  .drawer-close {
    flex: 0 0 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 13px;
    background: var(--soft);
    color: var(--ink);
    cursor: pointer;
  }
  .drawer-body { overflow: auto; overscroll-behavior: contain; padding: 2px 24px 28px; color: var(--muted); line-height: 1.65; }
  .drawer-body section + section { margin-top: 22px; padding-top: 20px; border-top: 1px solid var(--line); }
  .drawer-body h3 { margin: 0 0 6px; color: var(--ink); font-size: 16px; }
  .drawer-body p { margin: 0; font-size: 14px; }
  .drawer-body p + p { margin-top: 9px; }
  .about-changes { margin: 12px 0 0; padding-inline-start: 18px; }
  .about-changes li + li { margin-top: 12px; }
  .about-changes strong { display: block; margin-bottom: 2px; color: var(--ink); font-size: 14px; }
  .about-links { margin: 12px 0 0; padding: 0; list-style: none; font-size: 13px; }
  .about-links a { color: var(--accent); text-underline-offset: 3px; }
  @starting-style {
    .load-dialog[open] { opacity: 0; transform: translateY(8px) scale(.98); }
    .about-drawer[open] { opacity: 0; transform: translateX(24px); }
    .load-dialog[open]::backdrop, .about-drawer[open]::backdrop { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .go, .bar i, .load-dialog, .load-dialog::backdrop, .about-drawer, .about-drawer::backdrop { transition: none; }
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
    color: var(--danger);
    overflow-wrap: anywhere;
    font-weight: 500;
    font-size: 14px;
  }
  .chat {
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 20px;
  }
  .msg {
    display: flex;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--soft);
  }
  .avatar {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    padding: 3px;
    image-rendering: pixelated;
    background: var(--soft);
  }
  .body {
    min-width: 0;
    font: 400 16px/1.45 Inter, sans-serif;
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
    margin-top: 14px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .pick {
    width: 100%;
    aspect-ratio: 1;
    padding: 8px;
    border: 0;
    border-radius: 14px;
    background: var(--soft);
    cursor: pointer;
  }
  .pick.empty {
    opacity: 0.5;
  }
  .pick.on {
    background: var(--tint);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .pick canvas, .pick img {
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
    appearance: none;
    width: 34px;
    height: 20px;
    margin: 0;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--soft);
    cursor: pointer;
  }
  .outline-option input::before {
    content: "";
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--muted);
  }
  .outline-option input:checked { background: var(--accent); border-color: var(--accent); }
  .outline-option input:checked::before { transform: translateX(14px); background: var(--on-accent); }
  @media (prefers-reduced-motion: no-preference) {
    .outline-option input::before { transition: transform 170ms ease; }
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
  .card-foot {
    margin-top: auto;
    padding-top: 13px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .meta {
    flex: 1 1 112px;
    min-width: 0;
    font-size: 12px;
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
  @media (max-width: 720px) {
    .stage { width: min(448px, 100%); }
    .stage { grid-template-columns: minmax(0, 1fr); grid-auto-rows: 1fr; }
  }
  @media (max-width: 640px) {
    main {
      padding: 32px 16px 36px;
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
