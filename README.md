# 词灯 · WordLamp

一词一画的雅思词汇学习应用。基于开源项目 [Word Atlas（词光）](https://github.com/designfuchen/word-atlas) 修改。

- 7,298 个词条，原创插画，FSRS 间隔复习
- 学习进度默认保存在浏览器里
- 授权与署名见 [NOTICE.md](NOTICE.md)、[LICENSE](LICENSE)、[CONTENT_LICENSE.md](CONTENT_LICENSE.md)

> 本项目不是官方雅思词表，与雅思（IELTS）考试主办方无关。内容由 AI 生成，未逐条人工审校。

## 本地运行

需要 Node.js 20+。

```
npm ci
npm run dev
```

构建：`npm run build`。如需使用外部录音存储，构建时设置环境变量 `VITE_AUDIO_BASE`。
