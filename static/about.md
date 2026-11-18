# Emoji Studio

Emoji Studio is a free, non-commercial web app that makes transparent 16×16 pixel emoji from text. Enter a short description to generate four variants, choose one, then copy the image or download a transparent PNG.

## What Emoji Studio adds

- **Model downloads.** The original Tessera-small and CLIP ONNX files are split into eight parts, each at most 16 MiB. The browser fetches up to four parts in parallel from the CDN and reassembles the two models in memory. The first visit downloads about 115 MB. Later visits reuse the cached parts while they remain available.
- **Outline repair.** An optional switch fills small gaps in the outer outline. Drag the comparison slider to inspect the original and repaired images. Copy and export use the switch's current setting.
- **Local history.** IndexedDB stores prompts, generation times, and variants in the browser. The history drawer can preview, copy, or download an earlier result while keeping the active workspace in place.
- **Display settings.** The responsive workspace supports English, Simplified Chinese, and light, dark, or system appearance.
- **Hosting and recovery.** Cloudflare Pages serves the UI. After an interrupted startup, the next load in the same tab tries one part at a time and uses the CPU to reduce memory pressure.

## Local inference and credits

The original [Slack Moji](https://huggingface.co/spaces/cfahlgren1/slack-moji) by Caleb Fahlgren brought Jagrat Patel’s [Tessera-small](https://huggingface.co/thejagstudio/tessera-small) to the browser. Emoji Studio uses the original model weights under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). ONNX Runtime Web runs on the visitor’s GPU through WebGPU or on their CPU through WebAssembly. Prompts, generated images, and history stay in the browser.

[Open Emoji Studio](https://emoji.firetable.tech/) · [简体中文](https://emoji.firetable.tech/zh/about.md) · [Source code](https://github.com/FireTable/emoji-studio)
