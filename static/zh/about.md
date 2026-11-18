# Emoji Studio

Emoji Studio 是免费的非商业网页工具。输入一句描述，可以在浏览器中生成四张 16×16 的透明像素表情，再选一张复制或下载为透明 PNG。

## Emoji Studio 增加了什么

- **ONNX 模型拆包与并行下载。** 原版的 Tessera-small 和 CLIP 两个 ONNX 文件共拆成 8 个分片，每片最多 16 MiB。浏览器从 CDN 同时请求最多 4 片，再在内存里拼回两个模型。首次下载约 115 MB，之后可以复用浏览器缓存。
- **可选描边修复。** 修补外轮廓的小缺口，可拖动滑块比较原图和修复后的效果。复制和导出按当前修复开关取图。
- **本地历史。** 提示词、生成时间和各个版本保存在浏览器的 IndexedDB 中。历史抽屉支持预览、复制或下载旧结果，同时保留工作区当前结果。
- **工作区和显示设置。** 界面适配桌面和手机，支持简体中文、英文以及浅色、深色和跟随系统。
- **部署与加载恢复。** 网页部署在 Cloudflare Pages。模型加载中断后，同一个标签页下次打开会尝试逐片下载并改用 CPU，以减轻内存压力。

## 本地推理与鸣谢

原版 [Slack Moji](https://huggingface.co/spaces/cfahlgren1/slack-moji) 由 Caleb Fahlgren 创建，将 Jagrat Patel 的 [Tessera-small](https://huggingface.co/thejagstudio/tessera-small) 带到网页端。Emoji Studio 保留原始模型权重，适用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)。ONNX Runtime Web 通过 WebGPU 使用访客自己的 GPU，也可通过 WebAssembly 使用 CPU。提示词、生成结果和历史都留在浏览器中。

[打开 Emoji Studio](https://emoji.firetable.tech/zh/) · [English](https://emoji.firetable.tech/about.md) · [源代码](https://github.com/FireTable/emoji-studio)
