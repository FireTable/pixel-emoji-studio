<script lang="ts">
  import { LOCALES, type Locale } from "./i18n";
  import { dismissOnBackdrop } from "./dismissOnBackdrop";
  import type { HistoryEntry } from "./history";

  const GRID = 16;
  const EXPORT_SIZE = 128;
  const labels = {
    en: {
      close: "Close history",
      variants: "Saved variants",
      copyFailed: "Couldn’t copy the image. You can download the PNG instead.",
      downloadFailed: "Couldn’t download the image.",
    },
    zh: {
      close: "关闭历史记录",
      variants: "已保存的版本",
      copyFailed: "无法复制图片。可以下载 PNG。",
      downloadFailed: "无法下载图片。",
    },
  };

  let { locale, entries, hasMore, error, onMore }: {
    locale: Locale;
    entries: HistoryEntry[];
    hasMore: boolean;
    error: boolean;
    onMore: () => void;
  } = $props();

  let drawer: HTMLDialogElement;
  let expanded = $state<number | null>(null);
  let variant = $state(0);
  let status = $state("");
  let words = $derived(LOCALES[locale]);
  let local = $derived(labels[locale]);
  let time = $derived(new Intl.DateTimeFormat(words.lang, { dateStyle: "medium", timeStyle: "short" }));

  export function show() {
    if (!drawer.open) drawer.showModal();
  }

  async function close() {
    if (!drawer.open || drawer.hasAttribute("data-closing")) return;

    if (!CSS.supports("overlay", "auto")) {
      drawer.setAttribute("data-closing", "");
      await Promise.race([
        Promise.allSettled(drawer.getAnimations({ subtree: true }).map((animation) => animation.finished)),
        new Promise((resolve) => setTimeout(resolve, 350)),
      ]);
      drawer.removeAttribute("data-closing");
    }

    drawer.close();
  }

  function toggleEntry(id: number) {
    expanded = expanded === id ? null : id;
    selectVariant(0);
  }

  function selectVariant(index: number) {
    variant = index;
    status = "";
  }

  function draw(canvas: HTMLCanvasElement, pixels: HistoryEntry["pixels"][number]) {
    const context = canvas.getContext("2d");
    const paint = (data: HistoryEntry["pixels"][number]) => {
      context?.putImageData(new ImageData(data, GRID, GRID), 0, 0);
    };
    paint(pixels);
    return { update: paint };
  }

  function png(pixels: HistoryEntry["pixels"][number]): Promise<Blob> {
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = GRID;
    const source = sprite.getContext("2d");
    const output = document.createElement("canvas");
    output.width = output.height = EXPORT_SIZE;
    const target = output.getContext("2d");
    if (!source || !target) throw new Error("Canvas unavailable");

    source.putImageData(new ImageData(pixels, GRID, GRID), 0, 0);
    target.imageSmoothingEnabled = false;
    target.drawImage(sprite, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
    return new Promise((resolve, reject) => {
      output.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG export failed"));
      }, "image/png");
    });
  }

  async function download(entry: HistoryEntry) {
    const index = variant;
    try {
      const blob = await png(entry.pixels[index]);
      const url = URL.createObjectURL(blob);
      const name = entry.prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
      const link = document.createElement("a");
      link.download = (name.slice(0, 40) || "emoji") + ".png";
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (entry.id === expanded && index === variant) status = local.downloadFailed;
    }
  }

  async function copy(entry: HistoryEntry) {
    const index = variant;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png(entry.pixels[index]) })]);
      if (entry.id === expanded && index === variant) status = words.copied;
    } catch {
      if (entry.id === expanded && index === variant) status = local.copyFailed;
    }
  }
</script>

<dialog
  class="history-drawer"
  id="history-drawer"
  aria-labelledby="history-drawer-title"
  closedby="any"
  bind:this={drawer}
  use:dismissOnBackdrop={close}
  oncancel={(event) => {
    event.preventDefault();
    void close();
  }}
>
  <header class="drawer-head">
    <h2 id="history-drawer-title">{words.history}</h2>
    <button class="close" type="button" aria-label={local.close} onclick={close}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    </button>
  </header>

  <div class="drawer-body">
    {#if error}
      <p class="error" role="status">{words.historyError}</p>
    {/if}
    {#if entries.length === 0}
      {#if !error}<p class="hint">{words.historyEmpty}</p>{/if}
    {:else}
      <p class="hint">{words.historyHint}</p>
      <ul class="entries">
        {#each entries as entry (entry.id)}
          <li class:open={entry.id === expanded}>
            <button
              class="entry"
              type="button"
              aria-label={entry.prompt}
              aria-describedby={"history-time-" + entry.id}
              aria-expanded={entry.id === expanded}
              aria-controls={"history-entry-" + entry.id}
              onclick={() => toggleEntry(entry.id)}
            >
              {#if entry.pixels[0]}
                <canvas width={GRID} height={GRID} class="thumb" use:draw={entry.pixels[0]} aria-hidden="true"></canvas>
              {/if}
              <span class="entry-label">
                <span>{entry.prompt}</span>
                <time id={"history-time-" + entry.id} datetime={new Date(entry.createdAt).toISOString()}>{time.format(entry.createdAt)}</time>
              </span>
              <svg class="chevron" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m5 8 5 5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <div id={"history-entry-" + entry.id} hidden={entry.id !== expanded}>
              {#if entry.id === expanded && entry.pixels.length > 0}
                <div class="preview" role="img" aria-label={words.variation(variant + 1)}>
                  <canvas width={GRID} height={GRID} use:draw={entry.pixels[variant]} aria-hidden="true"></canvas>
                </div>
                {#if entry.pixels.length > 1}
                  <div class="variants" role="group" aria-label={local.variants}>
                    {#each entry.pixels as pixels, index (index)}
                      <button
                        class="variant"
                        type="button"
                        aria-label={words.variation(index + 1)}
                        aria-pressed={variant === index}
                        onclick={() => selectVariant(index)}
                      >
                        <canvas width={GRID} height={GRID} use:draw={pixels} aria-hidden="true"></canvas>
                      </button>
                    {/each}
                  </div>
                {/if}
                <div class="actions">
                  <button class="download" type="button" onclick={() => download(entry)}>{words.download}</button>
                  <button type="button" onclick={() => copy(entry)}>{words.copy}</button>
                </div>
                <div class="result" role="status">{status}</div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      {#if hasMore}
        <button class="more" type="button" onclick={onMore}>{words.historyMore}</button>
      {/if}
    {/if}
  </div>
</dialog>

<style>
  .history-drawer {
    box-sizing: border-box;
    position: fixed;
    inset: 0 0 0 auto;
    width: min(100%, 29rem);
    height: 100vh;
    height: 100svh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-inline-start: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    overflow: hidden;
    overscroll-behavior: contain;
    opacity: 0;
    transition-property: opacity, transform, display, overlay;
    transition-duration: 240ms;
    transition-timing-function: ease-out;
    transition-behavior: allow-discrete;
  }

  .history-drawer[open] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .history-drawer[open]:not([data-closing]) {
    opacity: 1;
  }

  .history-drawer::backdrop {
    background-color: transparent;
    overflow: hidden;
    overscroll-behavior: contain;
    transition-property: background-color, display, overlay;
    transition-duration: 240ms;
    transition-timing-function: ease-out;
    transition-behavior: allow-discrete;
  }

  .history-drawer[open]:not([data-closing])::backdrop {
    background-color: rgb(15 11 25 / 48%);
  }

  @starting-style {
    .history-drawer[open]:not([data-closing]) { opacity: 0; }
    .history-drawer[open]:not([data-closing])::backdrop { background-color: transparent; }
  }

  @media (prefers-reduced-motion: no-preference) {
    .history-drawer { transform: translateX(100%); }
    .history-drawer[open]:not([data-closing]) { transform: translateX(0); }

    @starting-style {
      .history-drawer[open]:not([data-closing]) { transform: translateX(100%); }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .history-drawer, .history-drawer::backdrop { transition-duration: 80ms; }
  }

  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    border-block-end: 1px solid var(--line);
  }

  h2 {
    margin: 0;
    font-size: 1.25rem;
  }

  .drawer-body {
    padding: 1.25rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .hint, .error {
    margin: 0 0 1rem;
    font-size: 0.875rem;
    color: var(--muted);
  }

  .error { color: var(--danger); }

  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .close {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--soft);
  }

  .entries {
    display: grid;
    gap: 0.5rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .entries li {
    border: 1px solid var(--line);
    border-radius: 0.875rem;
  }

  .entry {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 0.75rem;
    border: 0;
    border-radius: inherit;
    background: transparent;
    text-align: start;
  }

  .entry:hover, .open .entry, .close:hover, .more:hover {
    background: var(--soft);
  }

  .entry-label {
    display: grid;
    flex: 1;
    gap: 0.15rem;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.9rem;
    font-weight: 550;
  }

  time {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--muted);
  }

  .chevron {
    flex-shrink: 0;
    color: var(--muted);
  }

  .open .chevron { transform: rotate(180deg); }

  canvas {
    display: block;
    image-rendering: pixelated;
  }

  .thumb {
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
  }

  .preview {
    display: grid;
    place-items: center;
    margin: 0.75rem;
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    aspect-ratio: 4 / 3;
    background: conic-gradient(var(--checker) 25%, transparent 0 50%, var(--checker) 0 75%, transparent 0)
      0 0 / 1.2rem 1.2rem;
  }

  .preview canvas {
    width: min(68%, 12rem);
    height: auto;
  }

  .variants, .actions {
    display: flex;
    gap: 0.5rem;
    margin: 0.75rem;
  }

  .variant, .actions button, .more {
    min-height: 2.75rem;
    border: 1px solid var(--line);
    border-radius: 0.65rem;
    background: var(--soft);
  }

  .variant {
    display: grid;
    place-items: center;
    width: 2.75rem;
    padding: 0.25rem;
  }

  .variant canvas {
    width: 1.75rem;
    height: 1.75rem;
  }

  .variant[aria-pressed="true"] {
    border-color: var(--accent);
    background: var(--tint);
  }

  .actions button {
    flex: 1;
    padding: 0.5rem;
    font-weight: 650;
  }

  .actions .download {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }

  .result {
    padding: 0 0.75rem 0.6rem;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .result:empty { padding: 0; }

  .more {
    width: 100%;
    margin-top: 0.75rem;
    padding: 0 0.75rem;
    background: transparent;
  }
</style>
