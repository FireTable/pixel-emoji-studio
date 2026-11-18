# Emoji Studio

输入一句描述，在浏览器内生成 16×16 的透明像素表情。Emoji Studio 是 FireTable 基于 [Slack Moji](https://huggingface.co/spaces/cfahlgren1/slack-moji) 制作的非商业改版。

[在线体验](https://emoji.firetable.tech/zh/) · [English](README.md) · [移动端截图](screenshots/mobile.png)

![Emoji Studio 桌面工作区的火焰描边对比](screenshots/desktop.png)

## 功能

- **本机生成。** Tessera-small 一次生成四个版本，可复制或导出透明 PNG。优先通过 WebGPU 使用本机 GPU，并提供 WebAssembly CPU 后备路径。
- **描边修复。** 可开关修复，拖动滑块对比原图和修复后的轮廓。
- **本地历史。** 提示词和生成结果存进当前浏览器的 IndexedDB，随时可以在历史抽屉里回看、复制或下载。
- **显示设置。** 支持简体中文、英文，以及浅色、深色和跟随系统。

## 本地运行

```sh
git clone https://github.com/FireTable/emoji-studio.git
cd emoji-studio
npm ci
npm run dev
```

用 `npm run check` 检查代码，`npm run build` 构建站点。网址加上 `?cpu` 即可测试 CPU 推理。

## 部署

把 `build/` 部署到支持 HTTPS 的静态站点。线上页面由 Cloudflare Pages 托管，约 115 MB 的 INT8 ONNX 权重拆成 8 片由 CDN 分发。浏览器最多同时下载 4 片，在内存中拼回模型，之后可以复用已缓存的分片。自行镜像权重见 [部署说明](README.md#deployment)。

中英文页面提供预渲染 HTML，附有 [中文 Markdown](https://emoji.firetable.tech/zh/about.md) 和 [`llms.txt` 索引](https://emoji.firetable.tech/llms.txt)。

## 鸣谢与许可

Emoji Studio 以 Caleb Fahlgren 的 [Slack Moji](https://huggingface.co/spaces/cfahlgren1/slack-moji) 页面源码为基础，沿用了聊天预览的设计，以及部分示例图和背景像素小图。FireTable 调整了工作区，增加了描边修复、历史记录和显示设置。

原版应用和 Jagrat Patel（TheJagStudio）训练的 [Tessera-small 权重](https://huggingface.co/thejagstudio/tessera-small#license) 采用 [CC BY-NC 4.0](LICENSE)。本站的改版和再分发的 Tessera 分片沿用该许可。商业使用 Tessera 需向模型作者另行取得授权。

感谢 Angais 发布 [Pixel Art Atlas 1.4M](https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m)，OpenAI 发布 [CLIP](https://github.com/openai/CLIP/blob/main/LICENSE)（MIT），以及 [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) 提供浏览器推理支持。
