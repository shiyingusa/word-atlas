import { ArrowUpRight, Database, Github, Heart } from "lucide-react";
import { useAtlas } from "../atlas/context";
import { REPO_URL, UPSTREAM_URL } from "../config";

const BASE = import.meta.env.BASE_URL;

const hasRecordings = !!(import.meta.env.VITE_AUDIO_BASE as string | undefined);

export function About() {
  const atlas = useAtlas();
  return (
    <div className="page about">
      <header className="about-hero">
        <img src={`${BASE}brand/og.webp`} alt="" />
        <div>
          <p className="eyebrow">关于词灯</p>
          <h1 className="display">一词一画，点亮雅思。</h1>
          <p className="lede">
            词灯把雅思阅读 8000 词整理成 {atlas.count.toLocaleString()} 个词条。每个词一幅原创插画，一句日常例句，一句雅思例句，配英美发音、常用搭配和易混提示。学会一个，就在你的星图上点亮一颗星。
          </p>
          <p className="lede">词灯基于开源项目“词光（Word Atlas）”改进而来。基础背词免费，学习进度默认保存在你自己的浏览器里。</p>
          <div className="about-actions">
            <a className="btn btn-primary" href={REPO_URL} target="_blank" rel="noreferrer">
              <Github size={18} /> 在 GitHub 上查看
            </a>
            <a className="btn btn-ghost" href={`${REPO_URL}/tree/main/data`} target="_blank" rel="noreferrer">
              <Database size={18} /> 下载词库 JSON / CSV
            </a>
          </div>
        </div>
      </header>

      <div className="about-grid">
        <section className="panel">
          <h3 className="eyebrow">为什么记得住</h3>
          <ul className="feature-list">
            <li>
              <b>先看见。</b>每个词都有一幅画，画的就是第一句例句里发生的事。
            </li>
            <li>
              <b>再想起。</b>选义、看图补句、听音辨词、拼写，从认得走到会写。
            </li>
            <li>
              <b>刚好在快忘时重逢。</b>FSRS 是新版 Anki 用的开源记忆算法，只在你快要遗忘时安排复习。
            </li>
            <li>
              <b>分数诚实。</b>只算第一次作答。答错的词会换个题型再见一面，但不会抬高正确率。
            </li>
            <li>
              <b>进度属于你。</b>进度默认存在你的浏览器里，随时能导出备份。
            </li>
          </ul>
        </section>

        <section className="panel">
          <h3 className="eyebrow">快捷键</h3>
          <dl className="keys">
            <div>
              <dt>
                <kbd>⌘</kbd>
                <kbd>K</kbd> 或 <kbd>/</kbd>
              </dt>
              <dd>搜索任何词</dd>
            </div>
            <div>
              <dt>
                <kbd>1</kbd>–<kbd>4</kbd>
              </dt>
              <dd>选择答案</dd>
            </div>
            <div>
              <dt>
                <kbd>Enter</kbd>
              </dt>
              <dd>确认 / 继续</dd>
            </div>
            <div>
              <dt>
                <kbd>←</kbd> <kbd>→</kbd>
              </dt>
              <dd>词卡里切换上一个、下一个</dd>
            </div>
            <div>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>关闭弹窗</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h3 className="eyebrow">内容从哪里来</h3>
          <p className="muted">
            释义、例句、搭配和提示由大语言模型按统一的词典规范重新撰写；插画由图像模型按统一画风逐词绘制；{hasRecordings ? "发音和朗读由 ElevenLabs 合成（英音 Alice，美音 Sarah）。" : "目前发音使用你设备自带的语音朗读，不同设备的音色会有差别；原项目附带的合成录音我们会在之后接入。"}所有内容都经过结构和一致性的自动校验，但没有逐条人工审校。看到错的地方，欢迎在 GitHub 提 Issue，或者直接改数据提 PR。
          </p>
          <p className="muted">词灯不是官方雅思词表，与雅思（IELTS）考试主办方无关，也不承诺提分。它只想把背单词这件事，做得好看一点、扎实一点。</p>
        </section>

        <section className="panel">
          <h3 className="eyebrow">开源与署名</h3>
          <p className="muted">
            词灯基于 Word Atlas（词光）项目修改而成。词库文本、插画与词条录音版权归 Word Atlas contributors，按{" "}
            <a className="link" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>{" "}
            授权，词灯对界面、功能和部分内容做了修改；应用代码按 MIT 授权。
          </p>
          <a className="link" href={UPSTREAM_URL} target="_blank" rel="noreferrer">
            原项目：Word Atlas · 词光 <ArrowUpRight size={14} />
          </a>
        </section>

        <section className="panel">
          <h3 className="eyebrow">给开发者</h3>
          <p className="muted">
            <code>data/word-atlas.json</code> 和 <code>.csv</code> 是完整词库；<code>public/atlas</code> 里是网页用的分块数据、插画和音频。拿去做 Anki 牌组、背词小程序、浏览器插件，或者 AI 应用的评测集，署名即可。
          </p>
          <a className="link" href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">
            阅读文档 <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
      <p className="colophon">
        <Heart size={14} /> 做给每一个在背单词的人。
      </p>
    </div>
  );
}
