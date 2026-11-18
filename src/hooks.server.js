export const handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace("%emoji.lang%", event.url.pathname.startsWith("/zh/") ? "zh-CN" : "en"),
  });
