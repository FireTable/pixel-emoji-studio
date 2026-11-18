<script lang="ts">
  import { onMount } from "svelte";
  import { LOCALES, type Locale } from "$lib/i18n";

  const themes = ["system", "light", "dark"] as const;
  const locales = ["en", "zh"] as const;
  const languages = { en: "English", zh: "简体中文" } as const;
  type Menu = "language" | "theme";

  let { locale, theme, onTheme, onHistory, onAbout }: {
    locale: Locale;
    theme: (typeof themes)[number];
    onTheme: (value: string) => void;
    onHistory: () => void;
    onAbout: () => void;
  } = $props();

  const words = $derived(LOCALES[locale]);
  const id = $props.id();
  const languageId = `${id}-language`;
  const themeId = `${id}-theme`;
  let fallback = $state(false);
  let open = $state<Menu | null>(null);
  let toolbar: HTMLElement;
  let languageTrigger: HTMLButtonElement;
  let themeTrigger: HTMLButtonElement;
  let languagePopover: HTMLElement;
  let themePopover: HTMLElement;

  onMount(() => { fallback = !("popover" in HTMLElement.prototype); });

  function toggle(menu: Menu) {
    if (fallback) open = open === menu ? null : menu;
  }

  function close(menu: Menu) {
    const popover = menu === "theme" ? themePopover : languagePopover;
    const trigger = menu === "theme" ? themeTrigger : languageTrigger;
    if (fallback) open = null;
    else popover.hidePopover();
    trigger.focus();
  }

  function dismissOutside(event: PointerEvent) {
    if (fallback && open && !event.composedPath().includes(toolbar)) open = null;
  }

  function dismissWithEscape(event: KeyboardEvent) {
    if (fallback && open && event.key === "Escape") close(open);
  }
</script>

<svelte:window onpointerdown={dismissOutside} onkeydown={dismissWithEscape} />

<header class="toolbar" aria-label={words.preferences} bind:this={toolbar}>
  <div class="group">
    <button type="button" class="icon" aria-label={words.history} title={words.history} onclick={() => { open = null; onHistory(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.3 7M3 6v5h5m4-3v4l3 2" /></svg>
    </button>
    <button type="button" class="icon" aria-label={words.about} title={words.about} onclick={() => { open = null; onAbout(); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></svg>
    </button>
  </div>

  <div class="group">
    <button
      type="button" class="icon" aria-label={words.theme} title={words.theme}
      popovertarget={themeId} aria-expanded={fallback ? open === "theme" : undefined}
      style:anchor-name={`--${themeId}`} bind:this={themeTrigger} onclick={() => toggle("theme")}
    >
      {#if theme === "dark"}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 14.1A9 9 0 0 1 9.9 3.2a9 9 0 1 0 10.9 10.9Z" /></svg>
      {:else if theme === "light"}
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v3m-4 0h8" /></svg>
      {/if}
    </button>
    <div id={themeId} popover="auto" class="options theme-options" class:fallback-open={fallback && open === "theme"} style:--trigger={`--${themeId}`} bind:this={themePopover}>
      <p>{words.theme}</p>
      {#each themes as mode (mode)}
        <button type="button" class="option" aria-pressed={theme === mode} onclick={() => { onTheme(mode); close("theme"); }}>
          {words.appearance[mode]}
          {#if theme === mode}<span aria-hidden="true">✓</span>{/if}
        </button>
      {/each}
    </div>

    <button
      type="button" class="icon" aria-label={words.languages} title={words.languages}
      popovertarget={languageId} aria-expanded={fallback ? open === "language" : undefined}
      style:anchor-name={`--${languageId}`} bind:this={languageTrigger} onclick={() => toggle("language")}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18m-9-9c2.3 2.5 3.5 5.5 3.5 9s-1.2 6.5-3.5 9c-2.3-2.5-3.5-5.5-3.5-9s1.2-6.5 3.5-9Z" /></svg>
    </button>
    <nav id={languageId} aria-label={words.languages} popover="auto" class="options" class:fallback-open={fallback && open === "language"} style:--trigger={`--${languageId}`} bind:this={languagePopover}>
      <p>{words.languages}</p>
      {#each locales as lang (lang)}
        <a class="option" href={LOCALES[lang].path} hreflang={LOCALES[lang].lang} lang={LOCALES[lang].lang} aria-current={locale === lang ? "page" : undefined} onclick={() => close("language")}>
          {languages[lang]}
          {#if locale === lang}<span aria-hidden="true">✓</span>{/if}
        </a>
      {/each}
    </nav>
  </div>
</header>

<style>
  .toolbar {
    --gutter: max(16px, (100vw - 920px) / 2);
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: min(920px, calc(100% - 32px));
    margin: 20px auto 0;
  }

  .group {
    display: flex;
    gap: 7px;
  }

  .icon {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 15px;
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
    transition: background-color 140ms, color 140ms, border-color 140ms;
  }

  .icon:hover, .icon[aria-expanded="true"] {
    background: var(--soft);
    color: var(--accent);
  }

  .icon svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.65;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .options {
    display: none;
    position: fixed;
    inset: 70px var(--gutter) auto auto;
    width: min(188px, calc(100vw - 32px));
    margin: 0;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 15px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 12px 38px var(--shadow);
    opacity: 0;
    z-index: 5;
    transition-property: opacity, translate, display, overlay;
    transition-duration: 150ms;
    transition-timing-function: ease-out;
    transition-behavior: allow-discrete;
  }

  .theme-options { right: calc(var(--gutter) + 49px); }

  @supports (top: anchor(bottom)) {
    .options {
      position-anchor: var(--trigger);
      top: calc(anchor(bottom) + 7px);
      right: anchor(right);
    }
  }

  .options:is(:popover-open, .fallback-open) {
    display: block;
    opacity: 1;

    @starting-style { opacity: 0; }
  }

  @supports selector(:popover-open) {
    .toolbar:has(.theme-options:popover-open) .icon[popovertarget$="-theme"],
    .toolbar:has(nav:popover-open) .icon[popovertarget$="-language"] {
      background: var(--soft);
      color: var(--accent);
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .options { translate: 0 -4px; }
    .options:is(:popover-open, .fallback-open) {
      translate: none;

      @starting-style { translate: 0 -4px; }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .options { transition-duration: 60ms; }
    .icon { transition: none; }
  }

  p {
    margin: 0;
    padding: 8px 9px 4px;
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .option {
    display: flex;
    width: 100%;
    min-height: 41px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 9px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 550;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .option[aria-pressed="true"], .option[aria-current="page"] { color: var(--accent); }
  .option:hover { background: var(--soft); }
</style>
