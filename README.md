# 拾知 Glean

一款本地优先的 Obsidian 笔记桌面助手。把字幕、视频、零散笔记和追问，沉淀为自己的知识。

## 已实现

- **知识花园**：动态知识植物、累计笔记与双链、学习天数、连续积累、12 周足迹、视频时长和补丁统计。数据全部来自实际使用，初始状态为零。
- **TXT 字幕 → 笔记**：由用户直接提供 `.txt` 字幕文件，支持 UTF-8 与 GB18030 编码，保留原始字幕用于查阅、导出和对话。应用不再通过视频链接抓取字幕。
- **MP4 → 字幕 → 笔记**：内置 FFmpeg 音轨提取，按 10 分钟切成单声道 WAV，调用你配置的 Whisper 兼容语音服务。无需另外安装 FFmpeg。
- **整理笔记**：粘贴 Markdown、导入 `.md` 或选择 Obsidian 仓库里的文件。重排结构并保留知识细节、图片、链接、原有 frontmatter。
- **长字幕处理**：按可配置字符预算分段，各段由模型独立理解生成，前段结尾提供衔接；最终只让模型构建全篇导读与元信息，按顺序合并全部正文，避免单次最终输出压缩掉章节。分段检查点支持失败重试。
- **笔记对话**：结合正文、原始字幕和最近对话；长上下文按问题检索相关片段。有价值的确定解释，以 `> [!question]- 补丁：…` 插入唯一对应原句旁，保留版本，可恢复。
- **本地设置**：文本模型地址、名称与密钥；独立语音模型；仓库及子目录；分段长度；自动补丁开关。
- **写入 Obsidian**：写入所选仓库，保留同名文件，自动添加序号；支持直接在 Obsidian 打开，以及单独导出 Markdown。

## 开始使用

已构建的 macOS Apple Silicon 应用位于 `release/mac-arm64/拾知 Glean.app`。本地构建使用 ad-hoc 签名，尚未进行 Apple 公证。

打开后先进入「偏好设置」：

1. 填写模型 **Base URL**（例如服务商提供的 `/v1` 根路径）、**模型名称**和 **API Key**。支持 Chat Completions 兼容接口，本地免密服务可以留空 Key。
2. 如果需要本地 MP4 转写，填写语音模型。语音服务地址和密钥可独立配置，也可留空复用文本模型配置。语音接口须兼容 `/audio/transcriptions`。
3. 选择 Obsidian 仓库，保存并测试连接。
4. 从「拾取新知」导入 `.txt` 字幕、本地 MP4 或已有 Markdown。点击顶部进度状态查看当前任务和失败原因；完成后在「我的笔记」查看结果，进度面板不展示历史记录。
5. 打开笔记阅读、编辑、追问；点击「写入 Obsidian」导出当前版本。

仓库内的原笔记不会被直接覆盖。聊天补丁保存在拾知内部笔记版本中，需要再次点击「写入 Obsidian」导出更新后的副本。

## 从源码运行

要求 Node.js 22.12+、Python 3.11+，推荐使用 `uv`。

```bash
uv venv --python 3.11
uv pip install -r backend/requirements.lock
npm ci
npm run desktop
```

桌面模式会构建前端、自动启动本地 Python 服务并打开窗口。

开发预览：

```bash
npm run dev
```

打开 `http://127.0.0.1:5173`。浏览器预览需手动输入仓库绝对路径；原生目录选择与 Obsidian 启动由桌面版提供。

## 构建和检查

```bash
npm run build       # TypeScript 检查 + 前端生产构建
npm run test        # 进度筛选、后端单元和本机集成测试
npm run package     # 打包 Python、FFmpeg 和 Electron，生成本机应用目录
```

目前已在 macOS Apple Silicon 上验证构建。Windows / Linux 的发布构建尚未验证；打包脚本的 Python 可执行路径与环境变量写法需要按平台调整。

## 数据与模型

- 开发模式：项目中的 `.glean/`。
- 安装版：Electron `userData` 的 `data/` 子目录（macOS 通常是 `~/Library/Application Support/glean/data/`，以 Electron 实际应用名称为准）。
- SQLite 保存笔记、字幕、对话、版本、统计事件和任务；本地文件保存设置及分段检查点。
- API Key 默认隐藏，点击设置页的眼睛按钮可查看或隐藏已保存的密钥。日常设置读取始终脱敏，只有显式查看才通过本地鉴权接口返回对应密钥，响应禁止缓存。密钥不写入笔记；保存于仅当前用户可读的本地 `settings.json`，**不是系统钥匙串加密存储**。
- 模型调用会把相应字幕/笔记/问题发送到你配置的服务；本地视频的音频分段会发送到语音服务。
- 本地 API 仅监听 `127.0.0.1`，每次桌面启动使用随机会话令牌；渲染窗口启用 sandbox 和 context isolation，关闭 Node 集成。

## 实现边界

- 不支持通过 YouTube、哔哩哔哩等视频链接抓取字幕；请先导出为 `.txt` 后上传。
- 文本和语音都使用用户配置的服务；没有内置离线 ASR 模型，也没有内置免费模型额度。
- 长上下文对话使用本地关键词片段检索，不是向量数据库；回答应注明资料不足。
- 分段合并保留每段生成正文，但模型内容质量仍受所选模型影响。检测到输出被截断或整理时遗漏图片，会停止保存并提示重试。
- 退出会中断当前任务。重新启动后任务标记为失败，可通过进度面板重试并复用已完成分段。
- 本版本不包含账户、云同步、多用户、课程推荐或博客生成。

## 结构

```text
src/                    React + TypeScript 界面
src/components/         知识植物、导入、阅读/聊天、设置
backend/glean/          本地 API、模型工作流、字幕/音轨处理、SQLite
backend/tests/          工作流、数据安全和媒体集成测试
desktop/                Electron 主进程与最小化 preload 桥接
scripts/                开发启动、打包后后端检查
docs/                   产品设计与验证记录
```

笔记规则改编自 `/Users/zhaoqifan/Code/obsidian_curator_skill` 的字幕生成、整理、概念补丁与 Obsidian 格式指南；未引入原 skill 的博客生成功能。视觉设计参考 [Anthropic frontend-design](https://skills.sh/anthropics/skills/frontend-design)。
