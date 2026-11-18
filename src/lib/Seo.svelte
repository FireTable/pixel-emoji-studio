<script lang="ts">
  import { LOCALES, type Locale } from "./i18n";

  const origin = "https://emoji.firetable.tech";
  const image = origin + "/og.png";
  const name = "Emoji Studio";
  const license = "https://creativecommons.org/licenses/by-nc/4.0/";

  let { locale }: { locale: Locale } = $props();
  let copy = $derived(LOCALES[locale]);
  let alternate = $derived(LOCALES[locale === "en" ? "zh" : "en"]);
  let url = $derived(origin + copy.path);
  let structuredData = $derived(
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name,
      url,
      description: copy.description,
      image,
      inLanguage: copy.lang,
      applicationCategory: "MultimediaApplication",
      isAccessibleForFree: true,
      license,
      isBasedOn: "https://huggingface.co/spaces/cfahlgren1/slack-moji",
      featureList: copy.aboutChanges.items.map(({ title }) => title),
    }).replaceAll("<", "\\u003c"),
  );
</script>

<svelte:head>
  <title>{copy.title}</title>
  <meta name="description" content={copy.description} />
  <link rel="canonical" href={url} />
  <link rel="alternate" hreflang="en" href={origin + LOCALES.en.path} />
  <link rel="alternate" hreflang="zh-CN" href={origin + LOCALES.zh.path} />
  <link rel="alternate" hreflang="x-default" href={origin + LOCALES.en.path} />
  <link rel="alternate" type="text/markdown" href={url + "about.md"} />
  <link rel="describedby" href={origin + "/llms.txt"} />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content={name} />
  <meta property="og:title" content={copy.title} />
  <meta property="og:description" content={copy.description} />
  <meta property="og:url" content={url} />
  <meta property="og:locale" content={copy.ogLocale} />
  <meta property="og:locale:alternate" content={alternate.ogLocale} />
  <meta property="og:image" content={image} />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={copy.imageAlt} />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={copy.title} />
  <meta name="twitter:description" content={copy.description} />
  <meta name="twitter:image" content={image} />
  <meta name="twitter:image:alt" content={copy.imageAlt} />

  {@html `<script type="application/ld+json">${structuredData}</script>`}
</svelte:head>
