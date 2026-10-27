# 批注器 · pdf-annotator

> 在 Edge / Chrome 里读 PDF、EPUB 和网页，**选中文字就能高亮 + 写笔记**，旁边还有个能读到原文的 AI 助手。

扩展自带 pdf.js 阅读器（不依赖浏览器内置 PDF 阅读器），批注保存在本地 IndexedDB，
换机器不联网也能用；AI 面板可接 **任意 OpenAI 兼容服务**（DeepSeek / Kimi / 智谱 / 通义 / OpenAI / Ollama / 自建网关），
API Key 由你自己提供，只存在你自己的浏览器里。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Manifest V3](https://img.shields.io/badge/manifest-v3-green.svg)

> **第三方客户端声明**：本扩展是独立开源项目，**不是** DeepSeek、OpenAI、Ollama 或任何模型厂商的官方产品，
> 与其无隶属关系、未获其背书。界面为自建，**不会**调用任何厂商的网页版聊天接口，
> 只按 OpenAI 兼容格式请求你填写的 `/chat/completions`。相关名称与商标归其各自所有者。

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [功能一览](#功能一览)
- [安装](#安装)
- [快速开始](#快速开始)
- [怎么打开文档](#怎么打开文档四个入口)
- [批注怎么用](#批注怎么用)
- [侧边栏：批注与 AI](#侧边栏批注与-ai)
- [导出](#导出)
- [接入模型服务](#接入模型服务)
- [Ollama（本机 / 远程 / 遇到 403）](#ollama本机--远程--遇到-403)
- [Agent 工具](#agent-工具v1-只读)
- [数据与隐私](#数据与隐私)
- [已知限制](#已知限制)
- [常见问题](#常见问题)
- [开发](#开发)
- [路线图](#路线图)
- [声明与免责](#声明与免责)

---

## 它解决什么问题

读论文、教材、技术文档时，常见的工作流是这样的：

1. 高亮一段 → 手动复制到笔记软件 → 回到 PDF → 忘了刚才在哪
2. 想就某段问 AI → 再打开网页版 → 手动粘贴 → 上下文还得自己补
3. 换台机器 / 重开文件 → 高亮全丢，因为那是某个阅读器私有的标注

这个扩展把这三件事塞进同一个页面：

- **批注是文字级的**，锚在原文的字符区间上，不锚在坐标上 → 换缩放、重开文件都能还原
- **AI 就在旁边**，能读到当前页原文、你选中的一段、以及你已有的批注
- **数据在本地**，IndexedDB 存你自己浏览器里，不经过任何中间服务器

---

## 功能一览

### 阅读

| 功能 | 状态 |
|---|---|
| PDF 阅读（pdf.js）：连续滚动、缩放、适合宽度、翻页、目录 | ✅ |
| 虚拟滚动：只渲染视口附近页面，几百页也不卡 | ✅ |
| EPUB 阅读（epub.js）：目录、CFI 定位 | ⚠️ 可用，未充分测试 |
| 网页正文阅读：抓取 HTML 后清洗排版 | ⚠️ 可用，正文提取为简版 |
| 阅读位置记忆（重开回到上次的页） | ✅ |

### 批注

| 功能 | 状态 |
|---|---|
| 选中文字 → 高亮（5 色）+ 笔记 | ✅ |
| 点击高亮重新编辑 / 改色 / 删除 | ✅ |
| 重开文档原位还原（字符偏移锚定，与缩放无关） | ✅ |
| 找不到原文时标「需重新定位」，不静默丢失 | ✅ |
| 整页 / 整书笔记 | ✅ |
| 侧边栏列表：搜索、点击跳回原文、闪烁提示 | ✅ |
| 导出 Markdown / JSON | ✅ |

### AI

| 功能 | 状态 |
|---|---|
| 侧边栏 Agent：流式输出、工具调用、可中断 | ✅ |
| 多服务接入（DeepSeek / Kimi / 智谱 / 通义 / OpenAI / Ollama / 自定义） | ✅ |
| 每个服务独立存配置，切换不丢 | ✅ |
| 「问 AI」按钮把选中的原文直接送进输入框 | ✅ |
| 只读工具：读当前页 / 选区 / 批注 / 搜文档 / 写笔记 | ✅ |
| 自动写批注、自动逐页笔记 | ⛔ 工具已声明但被 gate 关闭 |

---

## 安装

### 方式一：下载发布包（推荐普通用户）

1. 到 [Releases](https://github.com/Eric2007-sudo/pdf-annotator/releases/latest) 下载 `pdf-annotator-x.x.x.zip`
2. 解压到一个**你不会删除的目录**（扩展运行时依赖这个路径）
3. 打开 `edge://extensions`（Chrome 是 `chrome://extensions`）
4. 右上角打开 **开发人员模式**
5. 点 **加载解压缩的扩展**，选择解压出来的目录（里面应该能直接看到 `manifest.json`）
6. 进扩展卡片 → **详细信息** → 打开 **允许访问文件 URL**
   （只有想用快捷键 / 「打开当前标签页」时才必需；用「拖入文件」不需要）

> **这是浏览器扩展，但还没上架应用商店。** 所以安装方式是「加载解压缩的扩展」，
> 不是双击安装包。商店审核需要开发者账号和一段时间，在那之前 GitHub Release
> 是最快的分发方式；上架后这里会补商店链接。

### 方式二：从源码构建

```bash
git clone https://github.com/Eric2007-sudo/pdf-annotator.git
cd pdf-annotator
npm install      # postinstall 会自动把 pdf.js / epub.js 拷到 vendor/
npm run check    # 静态自检：语法、import 路径、manifest 引用
npm run pack     # 生成 dist/extension 和 zip
```

然后按上面的第 3–5 步加载 `dist/extension`。

> `vendor/` 和 `node_modules/` 不进仓库，`npm install` 会重新生成。

---

## 快速开始

1. 装好扩展后，点工具栏的扩展图标 → 打开侧边栏
2. 「批注」tab 顶部点 **打开阅读器（可拖入文件）**
3. 把 PDF 拖进新开的页面（或点「选择文件…」）
4. 在正文里**划选一段文字** → 松手后弹出气泡
5. 选颜色、写两句笔记 → **保存**（或 `Ctrl+Enter`）
6. 想提问就点阅读器右上角的 **AI**，或用气泡里的 **问 AI**

---

## 怎么打开文档（四个入口）

> **重要**：Edge / Chrome 自带的 PDF 阅读器是浏览器的内部页面，**不会显示任何扩展的右键菜单**。
> 所以在 PDF 上右键找不到「用批注器打开」是浏览器限制，不是扩展没装好。

| 入口 | 适用 | 步骤 | 需要文件权限 |
|---|---|---|---|
| **拖入文件**（最省事） | 本地 PDF / EPUB | 侧边栏点「打开阅读器（可拖入文件）」→ 拖文件进窗口 | 否 |
| **右键菜单** | 网页、网页上的链接 | 在 http/https 页面或 PDF 链接上右键 → 用批注器打开 | 否 |
| **右键：读选中文字** | 网页里选了一段 | 选中文字 → 右键 → 用批注器阅读选中文字 | 否 |
| **快捷键 `Ctrl+Shift+E`** | 已经用 Edge 开着的 PDF | 按快捷键，把当前标签页送进批注器 | 是 |
| **侧边栏按钮** | 同上 | 点「用批注器打开当前标签页」 | 是 |

快捷键可以在 `edge://extensions/shortcuts` 里改。

---

## 批注怎么用

| 操作 | 结果 |
|---|---|
| 划选文字后松手 | 弹出气泡，默认黄色 |
| 点气泡里的色块 | 切换高亮颜色（黄 / 绿 / 蓝 / 粉 / 紫） |
| 输入框写内容 | 作为这条批注的笔记一起保存 |
| `Ctrl+Enter` / 保存 | 写入本地数据库 |
| 点击页面上的高亮区域 | 重新打开气泡，可改色、改笔记、删除 |
| 气泡里的 **问 AI** | 打开侧边栏并把这段原文填进 Agent 输入框 |
| `Esc` | 关闭气泡 |

**高亮为什么不会跑位**：每条批注同时存了「页内归一化坐标」和「字符区间 + 原文摘录」。
重新打开时优先按字符偏移还原；失败就按原文搜索；再失败才退回历史坐标。
三种都失败时，列表里会显示「需重新定位」，而不是悄悄消失。

---

## 侧边栏：批注与 AI

侧边栏有两个 tab，也可以被阅读器内嵌到右侧（同一份界面）。

### 批注 tab

- 顶部：当前文档标题、页数
- **打开阅读器（可拖入文件）** / **用批注器打开当前标签页**
- 搜索框：按摘录或笔记内容过滤
- 列表：点击任意一条 → 阅读器跳到该页并让高亮闪一下
- 整页 / 整书笔记：单独一块，写长笔记用
- `⭳md` / `⭳json`：导出

### Agent tab

顶部有一行声明，标出当前用的是哪家服务、哪个模型：

> **第三方客户端** · 通过 API 调用 Ollama（qwen3:4b），与 DeepSeek 官方无关，非其官方产品。

- 勾选「附带当前页文本」：每次提问自动把当前页原文附在消息后面
- `Enter` 发送，`Shift+Enter` 换行
- 请求过程中会出现「停止」按钮
- 每次请求会先显示一行 `→ POST https://... · 模型名`，方便确认打到哪
- 出错时会给出可执行的排查步骤，而不是一句「请求失败」

---

## 导出

| 格式 | 内容 | 适合 |
|---|---|---|
| Markdown | 文档元信息 + 按位置排序的批注（原文引用 + 笔记 + 颜色/时间）+ 整书笔记 | 直接丢进 Obsidian / Typora |
| JSON | 文档、批注、笔记的完整结构（含锚点） | 备份、自己写脚本处理 |

**导出不含 API Key**，也不含任何本机路径以外的隐私信息。

---

## 接入模型服务

**扩展本身免费。是否花钱、花多少，取决于你选的服务。**

`⚙` → 设置页：先选「服务」，再填该服务的地址 / 模型 / key。每个服务各存一份配置，切换不丢。

| 服务 | Base URL | 需要 key | 备注 |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | 是 | `deepseek-flash` 便宜够用 |
| Kimi（月之暗面） | `https://api.moonshot.cn/v1` | 是 | 长文选 `moonshot-v1-32k` 及以上 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | 是 | `glm-4-flash` 有免费额度 |
| 通义千问（百炼） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 是 | `qwen-long` 适合超长文档 |
| 硅基流动 | `https://api.siliconflow.cn/v1` | 是 | 一个 key 用多家开源模型 |
| OpenRouter | `https://openrouter.ai/api/v1` | 是 | 模型名要写全，如 `anthropic/claude-3.5-sonnet` |
| OpenAI | `https://api.openai.com/v1` | 是 | 需要能直连的网络或中转地址 |
| Ollama（本机 / 隧道） | `http://127.0.0.1:11434/v1` | 否 | 免费，**只能你自己用** |
| Ollama（经本地中继） | `http://127.0.0.1:11500/v1` | 否 | 服务端返回 403 时用 |
| 自定义 | 任意 | 视服务 | vLLM / LM Studio / One API / 自建网关 |

> **别人能不能用我的模型？** 不能，也不需要。
> Ollama 跑在你自己的机器或服务器上，端口不对外——这是安全边界。
> 别人装了这个扩展，要么填**他自己的** key（花他自己的钱），要么在他自己机器上跑 Ollama。
> 扩展不代理、不共享、不中转任何人的请求。

### key 的安全性

| 事项 | 现状 |
|---|---|
| 存在哪 | `chrome.storage.local`，**仅本机、不同步** |
| 是否加密 | **不加密**，明文；UI 与文档都明示，请勿在公用电脑填写 |
| 是否进代码 | 不进，默认值为空字符串 |
| 是否进导出 | 不进 |
| 谁发请求 | 扩展后台 Service Worker，key 不进入页面渲染层 |
| 发给谁 | 只有你填的那个 Base URL；没有 key 时**不发** `Authorization` 头 |
| 明文传输 | 填 `http://` 且非本机时，设置页会立即警告 |
| 能否清除 | 设置页有「清除本机 key」 |

---

## Ollama（本机 / 远程 / 遇到 403）

### 本机

```bash
ollama pull qwen3:4b
```

设置页选 **Ollama（本机 / 隧道）**，Base URL `http://127.0.0.1:11434/v1`，key 留空。

### 远程服务器（推荐 SSH 隧道）

```bash
# 服务端：只监听回环，外部连不到
OLLAMA_HOST=127.0.0.1:11434 ollama serve
```

```powershell
# 本机：开隧道，保持窗口开着
ssh -N -L 11434:127.0.0.1:11434 user@your-server
```

```powershell
# 验证
curl.exe -s http://127.0.0.1:11434/api/version
```

不要直接把 Ollama 绑到 `0.0.0.0` 暴露到内网——它没有认证。

### 遇到 HTTP 403

Ollama 默认只放行少数来源。扩展请求带 `Origin: chrome-extension://<扩展ID>`，
服务端直接回 **403**（空响应体）。这不是 key 问题，也不是浏览器 CORS，后台代理也绕不过。

**A. 有权限（或用户级 systemd，不需要 sudo）**

```bash
sudo systemctl edit ollama          # 系统级
systemctl --user edit ollama        # 用户级
```

```ini
[Service]
Environment="OLLAMA_ORIGINS=chrome-extension://你的扩展ID"
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart ollama
systemctl --user daemon-reload && systemctl --user restart ollama
```

> 不建议写 `chrome-extension://*`：那会让**所有**已装扩展都能访问你的模型服务。

**B. 没有 sudo：用项目自带的中继**

```powershell
# 终端 1
ssh -N -L 11434:127.0.0.1:11434 user@your-server

# 终端 2
npm run relay
```

设置页选 **Ollama（经本地中继）**，Base URL `http://127.0.0.1:11500/v1`。

中继只监听 `127.0.0.1:11500`，只做三件事：转发、去掉 `Origin`/`Referer`、原样透传流式响应。
不记录、不落盘、不上传。换端口：`$env:RELAY_PORT=11501; npm run relay`。

### 模型怎么选

| 模型 | 适合 | 注意 |
|---|---|---|
| `qwen3:4b` | **首选**，中文通顺、速度可接受 | 默认带思考过程，建议加 `{"think": false}` |
| `qwen3:1.7b` | 机器弱、只做简单问答 | 长文容易跑题 |
| `deepseek-r1:7b` | 推理、数学、逻辑 | 思考过程很长，很慢 |
| `qwen2.5-coder:7b` | 代码类文档 | 读论文/教材不推荐 |
| `bge-m3` 等 embedding 模型 | **不能对话** | 只做向量检索，别选 |

### 两个实用参数

设置页的 **额外请求体** 会原样合并进请求 JSON：

```json
{"think": false}
```

```json
{"options": {"num_ctx": 8192}}
```

---

## Agent 工具（v1 只读）

| 工具 | 说明 |
|---|---|
| `getCurrentPage` | 当前页文本 |
| `getSelection` | 用户当前选中的文字 |
| `getDocumentInfo` | 标题 / 类型 / 页数 / 批注数 |
| `getAnnotations` | 批注列表（可按页过滤） |
| `searchDocument` | 在**已渲染**的页面里搜关键词 |
| `writeNote` | 写一条整页 / 整书笔记 |

**未启用**（`sidepanel/agent/agent.js` 的 `TOOLS_DISABLED`）：
`createHighlight`、`autoNotePage`、`autoNoteAll`

要开写操作，把名字从 `TOOLS_DISABLED` 删掉并在 `tools.js` 的 `runTool` 里实现。
**建议先加「执行前确认」**，否则模型可能一次改掉几十条批注。

小模型多数不支持 OpenAI 风格 function calling，设置页可以关掉工具调用，
关掉后模型只依据消息里附带的「当前页文本」回答。

---

## 数据与隐私

全部数据在扩展自己的 IndexedDB（`pdf-annotator`，version 2）：

| 表 | 内容 |
|---|---|
| `documents` | `{id: sha256(type:url:size), type, title, url, size, page, createdAt, lastOpenedAt}` |
| `annotations` | `{id, docId, anchor, quote, color, note, tags, createdAt, updatedAt}` |
| `notes` | `{id, docId, body, locator:{page}}` |

锚点结构：

```js
// PDF：页内归一化坐标 + 字符区间 + 原文
{ kind:'pdf', page, quote, startOffset, endOffset, rects:[{x0,y0,x1,y1}] }
// EPUB
{ kind:'epub', cfi, quote, spineIndex }
// 网页
{ kind:'web', selectorPath, textOffset, quote }
```

- 没有任何遥测、统计、崩溃上报
- 打开网页时只抓取你主动右键的那一个页面，正文存进本地库
- 只有你点「发送」时，提问和勾选附带的正文才会发到你配置的服务端

---

## 已知限制

1. **Edge 内置 PDF 阅读器不响应扩展右键菜单**（浏览器限制）→ 用「拖入文件」或快捷键
2. **扫描版 PDF 无法批注**（没有文本层），需要 OCR，本版不做
3. **`searchDocument` 只能搜已渲染的页**（虚拟滚动只渲染视口附近）
4. **EPUB 选区**靠 epub.js 的 `selected` 事件拿 CFI，气泡用鼠标位置定位
5. **网页正文提取**是简版（`article` / `main` 优先），复杂页面效果一般
6. **侧边栏与阅读器内嵌 dock 是同一份 UI**，两处同时开会各有一份状态（数据同库不冲突）
7. **缩放时批注重绘**依赖文本层重建，切页过快可能短暂空白
8. **拖入的本地文件**以「文件名+大小+修改时间」识别，改名或改文件会被当成新文档

---

## 常见问题

**Q：在 PDF 上右键，没有「用批注器打开」**
浏览器内置 PDF 阅读器不显示扩展菜单，不是安装失败。用侧边栏的「打开阅读器（可拖入文件）」，
或给当前标签页按 `Ctrl+Shift+E`（需要文件 URL 权限）。

**Q：侧边栏显示「未打开文档」**
先把文档用批注器打开，或点「用批注器打开当前标签页」。

**Q：聊天一直没反应**
按顺序查：① 中继 / 隧道窗口是否还开着；② 开关里的 `→ POST ...` 那行地址对不对；
③ 打开「检查视图 → 服务工作进程」看控制台报错。首次请求要等模型加载进显存，10–60 秒是正常的。

**Q：报 `HTTP 403`**
Ollama 的来源校验，见 [遇到 HTTP 403](#遇到-http-403)。

**Q：回答里出现一大段「让我想想…」**
那是推理模型的思考过程，已自动折叠；想彻底关掉，额外请求体填 `{"think": false}`。

**Q：回答重复出现两遍**
0.1.0 已修复（流式气泡与最终气泡合并）。

**Q：扩展重新加载后侧边栏就不动了**
旧的侧边栏页面会失效。关掉侧边栏再打开；新版会自动刷新一次并给出提示。

**Q：重新打开文档，高亮位置偏了**
说明这次是按「原文搜索」或「历史坐标」兜底还原的。列表里标「需重新定位」的是彻底失败的，
可以删掉重画。如果你能复现，请带上 PDF 和页码提 issue。

**Q：能同步到别的设备吗**
不能。数据只在本机浏览器里。要迁移就用导出的 JSON。

---

## 开发

```bash
npm run vendor   # 从 node_modules 拷 pdf.js / epub.js / marked / DOMPurify 到 vendor/
npm run icons    # 生成 icons/icon{16,32,48,128}.png
npm run check    # 语法 + import 路径 + manifest/HTML 引用 静态自检
npm run pack     # 打包到 dist/extension，并生成 zip
npm run relay    # 启动本地 Ollama 中继（绕开 403 用）
```

改完代码在 `edge://extensions` 点「重新加载」即可，不用重装。

### 目录结构

```
pdf-annotator/
├─ manifest.json                     MV3 清单
├─ background/service-worker.js      右键菜单 / 快捷键 / 侧边栏 / 消息中转 / LLM 请求代理
├─ reader/
│  ├─ reader.html|css|js             阅读器主控：加载、批注生命周期、面板通信
│  ├─ pdf/pdf-view.js                渲染 + 虚拟滚动 + 高亮层 + 选区捕获
│  ├─ pdf/text-layer.js              字符偏移映射（文字层用 pdf.js 官方 TextLayer）
│  ├─ epub/epub-view.js              epub.js + CFI 批注
│  ├─ web/web-view.js                正文清洗 + 选择器锚定
│  └─ annotate/ann-popover.js        批注气泡
├─ sidepanel/
│  ├─ panel.js|css|html              批注列表 / Agent 聊天
│  ├─ diag.js                        错误诊断栏（脚本异常直接显示）
│  ├─ tool-proxy.js                  把工具请求转给阅读器
│  └─ agent/
│     ├─ agent.js                    流式 + 工具循环
│     ├─ llm.js                      走后台 Service Worker 的请求层（含心跳保活）
│     ├─ tools.js                    工具定义与执行
│     ├─ settings.js                 多服务配置与迁移
│     └─ markdown.js                 渲染 + 思考内容过滤
├─ shared/                           db / model（锚定算法）/ export / messaging
├─ options/                          设置页
├─ scripts/                          sync-vendor / make-icons / check / pack / ollama-relay
├─ vendor/                           pdf.js、epub.js、marked、DOMPurify（生成物，不入库）
└─ icons/
```

### 技术要点

- **文字层用 pdf.js 官方 `TextLayer`**，不自己算矩阵（否则镜像、错位）
- **锚点优先级**：字符偏移 → 原文搜索 → 历史坐标
- **流式请求走后台 Port**，带 10 秒心跳，避免 MV3 后台在模型冷启动时被回收
- **跨域请求由后台发出**（有 `host_permissions`），不受目标站点 CORS 限制

---

## 路线图

- [ ] 自动逐页笔记（工具已声明，gate 关闭）
- [ ] Agent 写批注 + 执行前确认
- [ ] 全文索引，让 `searchDocument` 能搜整本
- [ ] 网页正文改用 Readability
- [ ] 批注按颜色 / 标签筛选
- [ ] 双栏对照阅读
- [ ] 导出到 Obsidian 库（File System Access）

---

## 声明与免责

- 本扩展为独立第三方客户端，**非** DeepSeek / OpenAI / Ollama 官方产品，无隶属、无背书；
  不使用其 Logo 或界面素材。
- **不抓取、不注入、不代理任何厂商的网页版聊天**。与模型的交互一律通过你自行配置的
  OpenAI 兼容 HTTP API。
- 「DeepSeek」「OpenAI」「Ollama」「Kimi」等名称与商标归其各自所有者，此处仅作服务识别之用。
- 你的提问与勾选附带的正文会发送到你配置的服务端，请自行判断内容敏感性。
  本扩展自身不收集、不上传任何数据。
- 因调用 API 产生的费用，以及你对相关服务条款的遵守，由你自行负责。

## 许可

[MIT](LICENSE)

## 依赖

- [pdf.js](https://github.com/mozilla/pdf.js) 4.10 — Apache-2.0
- [epub.js](https://github.com/futurepress/epub.js) 0.3 — BSD-2-Clause
- [marked](https://github.com/markedjs/marked) 12 — MIT
- [DOMPurify](https://github.com/cure53/DOMPurify) 3 — Apache-2.0 / MPL-2.0
