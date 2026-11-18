<script lang="ts">
  import { page } from "$app/state";
  import Studio from "$lib/Studio.svelte";

  let { children } = $props();
  const locale = $derived(page.url.pathname.startsWith("/zh/") ? "zh" : "en");
</script>

<Studio {locale} />
{@render children()}
