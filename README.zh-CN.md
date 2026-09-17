# bilidown

把 B 站和 YouTube 视频变成一份可学习、可检索、可保存的资料。B 站优先读取原生字幕，只有没有可用字幕时才回退到所选 ASR；YouTube 直接融合上游 `youtube-digest` 的 Supadata 原生字幕链路，不下载、不上传音轨。扩展在 Chrome 侧边栏中提供字幕浏览、AI 概览（DeepSeek / MiniMax）、完整总结笔记、章节、关键观点、选中文本解释、时间戳跳转和本地笔记。

## 当前功能

- 支持 `www.bilibili.com/video/BV...` 普通视频页
- 支持 YouTube `watch`、`shorts`、`live` 和 `youtu.be` 页面
- B 站优先读取原生字幕；没有可用字幕时，再回退到阿里云百炼 Fun-ASR、minimasr asr-1.0 或本地 Whisper
- B 站原生字幕会按时间停顿和字幕时长恢复中文标点，避免字幕列表显示成无标点长句
- 本机标点服务可用时，B 站和 YouTube 原生字幕会使用 sherpa-onnx CT-Transformer 中英标点模型
- YouTube 使用 Supadata `mode=native` 获取原生字幕，不经过 ASR
- 本地 Whisper 支持 OpenAI 兼容的 `/v1/audio/transcriptions` 和 `whisper.cpp` 的 `/inference`，可填写 `http://localhost` 或 `http://127.0.0.1` 地址，API Key 可留空；B 站音轨是 M4A，`whisper.cpp` 需启用 `--convert`
- 支持多 P 视频，自动识别当前分 P
- 点击字幕、章节或观点即可跳转播放器时间
- AI 生成概览、章节、重点和解释（支持 DeepSeek、MiniMax 及任意 OpenAI 兼容服务）
- 原文、中文和双语字幕视图
- 笔记与摘要缓存在 Chrome 本地
- 导出带时间戳的 Markdown 文本
- 不经过开发者服务器

## 限制

- minimasr asr-1.0 单文件 ≤50 MB 且 ≤500 秒；超过会自动提示切回阿里百炼
- 部分字幕可能要求登录 B 站后才能读取
- B 站番剧、直播和站外嵌入页暂未支持
- YouTube 视频必须有可用的原生字幕；没有字幕时不会自动转写音频
- 当前主要支持 Chrome 116 及以上版本

## 安装

1. 下载项目 ZIP 并解压到一个长期保留的文件夹。
2. Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择包含 `manifest.json` 的 `bilidown` 文件夹。
6. 在设置页选择 AI 模型（DeepSeek / MiniMax / 自定义）并填入 API Key。
7. B 站可选 ASR 服务；YouTube 需要填写 Supadata API Key。
8. 打开 B 站或 YouTube 视频，点击页面上的“AI 总结”按钮。

修改源码后，请回到 `chrome://extensions` 点击扩展卡片上的“重新加载”，然后刷新 B 站页面。

## 数据与密钥

API Key、笔记和缓存只保存在当前 Chrome 配置中。B 站字幕从站点接口读取，或下载音轨发送给所选 ASR；YouTube 使用 Supadata 获取原生字幕，不发送音频。使用 AI 功能时，相关字幕和视频信息会发送给你选择的 AI 服务。不要把 API Key 写进源码、提交记录、截图或聊天。

## 开发检查

```bash
npm test
npm run check
npm run package
```

打包结果位于 `dist/bilidown-v1.4.2.zip`。

## 许可证

本项目基于 [zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest) 二次开发，继续使用 MIT License。原项目版权信息保留在 `LICENSE` 中。
