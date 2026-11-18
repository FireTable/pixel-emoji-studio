# Emoji Studio

Make transparent 16×16 pixel emoji from a short prompt. Emoji Studio is FireTable’s non-commercial adaptation of [Slack Moji](https://huggingface.co/spaces/cfahlgren1/slack-moji).

[Live demo](https://emoji.firetable.tech/) · [简体中文](README-CN.md) · [Mobile screenshot](screenshots/mobile.png)

![Emoji Studio desktop workspace showing the fire sprite and outline comparison](screenshots/desktop.png)

## Features

- **Generate on your device.** Tessera-small makes four variants using WebGPU, with a WebAssembly CPU fallback. Copy an image or export a transparent PNG.
- **Repair and compare.** Toggle outline repair and drag the preview slider to compare it with the original.
- **Revisit past results.** The history drawer reads from IndexedDB, so prompts and images stay in your browser.
- **Choose your workspace.** English and Simplified Chinese, with light, dark, and system appearance.

## Run locally

```sh
git clone https://github.com/FireTable/emoji-studio.git
cd emoji-studio
npm ci
npm run dev
```

Run `npm run check` to check the code or `npm run build` to build the site. Add `?cpu` to the app URL to test CPU inference.

## Deployment

Deploy `build/` to an HTTPS static host. The live site runs on Cloudflare Pages. Its CDN serves roughly 115 MB of INT8 ONNX weights in eight parts, with up to four concurrent downloads. The browser reassembles the weights in memory and reuses cached parts on later visits.

The English and Chinese pages ship as prerendered HTML and link to their [Markdown overview](https://emoji.firetable.tech/about.md) and the [`llms.txt` index](https://emoji.firetable.tech/llms.txt).

<details>
<summary>Mirror the model files</summary>

1. Get `tessera_w8.onnx` and `clip_text_w8.onnx` from [Slack Moji revision `8e8aecc`](https://huggingface.co/spaces/cfahlgren1/slack-moji/tree/8e8aecc55e855a51bb952c892efbef647c0ce372/static/models).
2. Split each file into consecutive 16 MiB parts. Name them `tessera_w8.1.bin` through `tessera_w8.4.bin` and `clip_text_w8.1.bin` through `clip_text_w8.4.bin`.
3. Set `MODEL_URL` in [`src/lib/client.js`](src/lib/client.js) to your mirror and configure CORS for a different origin. Update the cache name when changing model releases.

</details>

## Credits and license

The [Slack Moji app](https://huggingface.co/spaces/cfahlgren1/slack-moji) by Caleb Fahlgren and the [Tessera-small weights](https://huggingface.co/thejagstudio/tessera-small#license) by Jagrat Patel (TheJagStudio) are available under [CC BY-NC 4.0](LICENSE). Emoji Studio follows those terms for the adaptation and redistributed Tessera shards. A commercial license for Tessera requires separate permission from its author.

Thanks to Angais for [Pixel Art Atlas 1.4M](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m), OpenAI for [CLIP](https://github.com/openai/CLIP/blob/main/LICENSE) (MIT), and the [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) project.
