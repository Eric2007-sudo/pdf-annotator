// API Agent：DeepSeek 兼容 OpenAI 的 /chat/completions。
// v1 只读：能读当前页、选区、批注、目录；能写"笔记"（notes 表），不能改批注。
// 预留但未启用的工具在 TOOLS_DISABLED 里，打开方式见 README。

import { renderMarkdown } from "./markdown.js";
import { AGENT_TOOLS, runTool } from "./tools.js";
import { getSettings } from "./settings.js";
import { streamChat } from "./llm.js";

const TOOLS_DISABLED = new Set(["createHighlight", "autoNotePage", "autoNoteAll"]);

export class Agent {
  /**
   * @param {(m:{role:string,text?:string,html?:string,streaming?:boolean})=>void} emit
   */
  constructor(emit) {
    this.emit = emit;
    this.messages = []; // {role, content, tool_calls?, tool_call_id?}
    this.context = null;
    this.busy = false;
    this.abort = null;
    this.onStateChange = () => {};
  }

  setContext(ctx) {
    this.context = ctx;
  }

  reset() {
    this.messages = [];
  }

  stop() {
    this.abort?.abort();
  }

  setBusy(b) {
    this.busy = b;
    this.onStateChange({ busy: b });
  }

  /**
   * @param {string} text
   * @param {{attachPage?:boolean}} opts
   */
  async ask(text, { attachPage = true } = {}) {
    if (this.busy) return;
    const settings = await getSettings();

    // 需要 key 的 provider 才拦；本地 Ollama 之类不需要
    if (settings.provider?.needsKey !== false && !settings.apiKey) {
      const name = settings.provider?.name || "该服务";
      this.emit({
        role: "assistant",
        html:
          `<p><strong>还没配置 ${escapeAttr(name)} 的 API Key。</strong></p>` +
          `<p>点右上角 ⚙ 打开设置，选择服务并填入你自己的 key。</p>` +
          `<p class="fine">本面板是第三方客户端：只调用你配置的服务接口，不内置任何 key，也不会未经声明就转发你的内容。</p>`,
      });
      return;
    }

    const userContent = this.buildUserContent(text, attachPage);
    this.messages.push({ role: "user", content: userContent });
    this.emit({ role: "user", text });
    // 明确显示这次请求打到哪，便于判断是扩展问题还是服务/隧道问题
    this.emit({ role: "tool", text: `→ POST ${settings.baseUrl.replace(/\/+$/, "")}/chat/completions · ${settings.model}` });

    this.setBusy(true);
    this.abort = new AbortController();

    try {
      await this.loop(settings);
    } catch (e) {
      if (e.name !== "AbortError") {
        this.emit({ role: "assistant", text: "**请求失败**：" + explainError(e) });
      }
    } finally {
      this.setBusy(false);
      this.abort = null;
    }
  }

  buildUserContent(text, attachPage) {
    if (!attachPage || !this.context) return text;
    const parts = [];
    if (this.context.title) parts.push(`文档：${this.context.title}（第 ${this.context.page ?? 1} 页）`);
    if (this.context.pageText) parts.push("当前页文本：\n\"\"\"\n" + truncate(this.context.pageText, 6000) + "\n\"\"\"");
    if (this.context.annotations?.length) {
      parts.push(
        "我的批注：\n" +
          this.context.annotations
            .slice(0, 40)
            .map((a) => `- p${a.page ?? "?"}: ${a.quote || ""}${a.note ? "（笔记：" + a.note + "）" : ""}`)
            .join("\n")
      );
    }
    return `${text}\n\n---\n${parts.join("\n\n")}`;
  }

  async loop(settings) {
    // 最多 6 轮工具调用，避免死循环
    for (let turn = 0; turn < 6; turn++) {
      const res = await this.callOnce(settings);
      this.messages.push(res.message);

      if (!res.message.tool_calls?.length) {
        return;
      }

      for (const call of res.message.tool_calls) {
        const name = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {}

        if (TOOLS_DISABLED.has(name)) {
          this.messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "该工具在本版本未启用（写操作需显式开启）" }),
          });
          continue;
        }

        this.emit({ role: "tool", text: `调用 ${name}(${truncate(call.function?.arguments || "", 300)})` });
        let out;
        try {
          out = await runTool(name, args, this.context);
        } catch (e) {
          out = { error: String(e?.message || e) };
        }
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: truncate(JSON.stringify(out), 12000),
        });
      }
    }
    this.emit({ role: "assistant", text: "（达到工具调用轮次上限，已停止）" });
  }

  async callOnce(settings) {
    const base = (settings.baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "");
    const body = {
      model: settings.model || "deepseek-flash",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...this.messages],
      temperature: 0.3,
      stream: true,
    };
    if (settings.toolsEnabled !== false) {
      body.tools = AGENT_TOOLS.map((t) => ({ type: "function", function: t }));
      body.tool_choice = "auto";
    }
    // 额外请求体：用于传各服务特有的参数，如 Ollama 的 {"think": false}
    Object.assign(body, parseExtraBody(settings.extraBody));

    const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    // 没有 key 的本地服务（Ollama 等）不发 Authorization，避免无意义地暴露凭据
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

    // SSE 增量解析
    let buffer = "";
    let content = "";
    const toolCalls = [];
    let sawContent = false;

    const handleLine = (line) => {
      const l = line.trim();
      if (!l.startsWith("data:")) return;
      const data = l.slice(5).trim();
      if (!data || data === "[DONE]") return;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      const delta = chunk.choices?.[0]?.delta || chunk.message;
      if (!delta) return;

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          toolCalls[i] ||= { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
        }
      }

      if (delta.content) {
        content += delta.content;
        sawContent = true;
        this.emit({ role: "assistant", html: renderMarkdown(content), streaming: true });
      }
    };

    await streamChat({
      url: `${base}/chat/completions`,
      headers,
      body: JSON.stringify(body),
      signal: this.abort?.signal,
      onText: (text) => {
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) handleLine(line);
      },
    });

    if (buffer.trim()) handleLine(buffer);
    if (sawContent) this.emit({ role: "assistant", html: renderMarkdown(content), streaming: false });

    const message = { role: "assistant", content: content || null };
    const calls = toolCalls.filter(Boolean);
    if (calls.length) message.tool_calls = calls.map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
    return { message };
  }
}

const SYSTEM_PROMPT = `你是嵌入在 PDF/EPUB 阅读器里的阅读助手。
用户可以选中文字向你提问，你也可以调用工具读取当前文档的上下文。
规则：
1. 回答用简体中文，简洁、具体，优先引用原文。
2. 需要原文时先用工具取，不要凭空猜测文档内容。若本会话未启用工具，就只依据用户消息里附带的原文回答，并说明取材范围。
3. 你只能读，不能修改文档。可以写笔记（writeNote），写入前先用一句话说明你要写什么。
4. 数学公式用行内代码或纯文本表示，不要用 LaTeX 渲染语法。`;

/** 把底层错误翻译成能照着做的提示 */
function explainError(e) {
  const msg = String(e?.message || e);
  if (/failed to fetch|networkerror|load failed|err_connection|err_failed/i.test(msg)) {
    return (
      msg +
      "\n\n排查顺序：\n" +
      "1. 跑隧道那个窗口还开着吗（`ssh -N -L ...`）\n" +
      "2. 另开窗口执行 `curl.exe -s http://127.0.0.1:11434/api/version`，有版本号吗\n" +
      "3. 服务端 `ollama list` 能跑吗（进程是否还在）\n" +
      "4. 上面那行「→ POST …」里的地址和你隧道本地端口一致吗"
    );
  }
  if (/HTTP 404/.test(msg)) {
    return msg + "\n\n404 通常是 Base URL 少了 `/v1`，或服务端不是 OpenAI 兼容接口。";
  }
  if (/HTTP 403/.test(msg)) {
    return (
      msg +
      "\n\n403 通常是服务端的来源校验，不是 key 的问题。若是 Ollama：\n" +
      "· 它默认只放行少数来源，扩展请求带 `Origin: chrome-extension://…`，会被直接拒绝；\n" +
      "· 要么服务端设 `OLLAMA_ORIGINS=chrome-extension://<扩展ID>` 后重启（需要权限）；\n" +
      "· 要么不改服务端：在项目目录跑 `npm run relay`，再把服务切到「Ollama（经本地中继）」、\n" +
      "  Base URL 用 `http://127.0.0.1:11500/v1`。"
    );
  }
  if (/HTTP 401/.test(msg)) {
    return msg + "\n\n401 是 key 不对或缺失：检查 API Key，或确认该服务是否需要 key。";
  }
  return msg;
}

function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** 解析设置里的「额外请求体」JSON；非法就忽略 */
function parseExtraBody(raw) {
  if (!raw || typeof raw !== "string") return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
