// 侧边栏面板：三个 tab —— 批注列表 / 官方 DeepSeek / API Agent。
// 同一份页面既可作为 side panel，也可被阅读器内嵌到右侧 dock（通过 postMessage 通信）。
import * as db from "/shared/db.js";
import { MSG } from "/shared/messaging.js";
import { exportMarkdown, exportJson, downloadText } from "/shared/export.js";
import { Agent } from "./agent/agent.js";
import { getSettings } from "./agent/settings.js";

const $ = (id) => document.getElementById(id);
const inIframe = window.top !== window.self;

const state = {
  docId: null,
  docMeta: null,
  annotations: [],
  notes: [],
  filter: "",
  readerTabId: null,
  unresolved: [],
};

const agent = new Agent(renderChatMessage);

/* ---------------- 启动 ---------------- */

init().catch((e) => {
  window.__diag?.("初始化失败", (e && (e.stack || e.message)) || String(e));
});

async function init() {
  // 每一步独立兜底：某一处出错不应让整个面板（尤其聊天）瘫掉
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      window.__diag?.(name, (e && (e.stack || e.message)) || String(e));
    }
  };

  await step("标签页绑定", bindTabs);
  await step("笔记区绑定", bindNotesUI);
  await step("聊天区绑定", ensureChatBound);
  await step("读取服务配置", refreshDisclosure);
  await step("连接阅读器", bindReader);
  await step("消息监听", bindMessages);
  await step("加载批注", reload);
}

/* ---------------- 第三方服务声明 ---------------- */

let vendorLabel = "AI";

// 明确告诉用户：这是独立客户端，通过 API 调用所选服务；不是 DeepSeek/OpenAI 官方产品，
// 也不通过网页版接口抓取对方会话。
async function refreshDisclosure() {
  try {
    const s = await getSettings();
    vendorLabel = s.provider?.vendor || "第三方服务";
    $("agentVendor").textContent = vendorLabel;
    $("agentModel").textContent = s.model || "—";
  } catch (e) {
    // 读不到配置也要让用户看见原因（常见：扩展重载后旧页面失效）
    window.__diag?.("读取配置失败", (e && (e.message || e)) || String(e));
  }
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.providerId || changes.configs) refreshDisclosure();
  });
} catch (e) {
  window.__diag?.("注册配置监听失败", (e && e.message) || String(e));
}

/* ---------------- tabs ---------------- */

function bindTabs() {
  for (const t of document.querySelectorAll(".tab")) {
    t.addEventListener("click", () => {
      for (const x of document.querySelectorAll(".tab")) x.classList.toggle("active", x === t);
      const name = t.dataset.tab;
      for (const p of document.querySelectorAll(".pane")) p.classList.toggle("active", p.dataset.pane === name);
      if (name === "agent") $("chatInput").focus();
    });
  }
  $("btnSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  bindOpenButtons();
}

/* ---------------- 打开文档的入口 ---------------- */
// Edge 内置 PDF 阅读器不响应扩展右键菜单，所以本地文件走「拖入阅读器」，
// 网页/链接仍可用右键菜单。

function bindOpenButtons() {
  $("btnOpenReader").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: MSG.READER_OPEN, payload: {} }).catch(() => {});
  });

  $("btnOpenCurrent").addEventListener("click", async () => {
    const tab = await activeTab();
    if (!tab?.url) return;
    if (tab.url.startsWith("chrome-extension://")) {
      $("panelDocMeta").textContent = "当前标签就是阅读器";
      return;
    }
    if (!/^(file|https?):/.test(tab.url)) {
      $("panelDocMeta").textContent = "这个页面打不开（浏览器内部页面）";
      return;
    }
    const type = /\.epub($|[?#])/i.test(tab.url)
      ? "epub"
      : /\.pdf($|[?#])/i.test(tab.url)
        ? "pdf"
        : "web";
    chrome.runtime.sendMessage({ type: MSG.READER_OPEN, payload: { url: tab.url, type } }).catch(() => {});
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

/* ---------------- 找到"当前阅读器" ---------------- */

async function bindReader() {
  // 1) 被阅读器内嵌：直接问宿主
  if (inIframe) {
    const ctx = await askHost({ type: MSG.READER_CONTEXT });
    if (ctx) applyContext(ctx);
    return;
  }
  // 2) 作为 side panel：找当前窗口里活动的 reader tab
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const candidate = tab && tab.url?.includes("/reader/reader.html") ? tab : null;
  const target = candidate || (await findAnyReaderTab());
  if (target) {
    state.readerTabId = target.id;
    const ctx = await sendToTab(target.id, { type: MSG.READER_CONTEXT });
    if (ctx) applyContext(ctx);
  }

  // 监听标签切换：用户切到阅读器就自动接上（不要求初始时就找到）
  chrome.tabs.onActivated.addListener(async () => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!t?.url?.includes("/reader/reader.html")) return;
    state.readerTabId = t.id;
    const c = await sendToTab(t.id, { type: MSG.READER_CONTEXT });
    if (c) {
      applyContext(c);
      await reload();
    }
  });
}

async function findAnyReaderTab() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("reader/reader.html") + "*" });
  return tabs[tabs.length - 1] || null;
}

function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp || null);
    });
  });
}

function askHost(msg) {
  return new Promise((resolve) => {
    const handler = (e) => {
      const d = e.data;
      if (d?.type === MSG.READER_CONTEXT_RESULT) {
        window.removeEventListener("message", handler);
        resolve(d.payload || null);
      }
    };
    window.addEventListener("message", handler);
    window.parent.postMessage(msg, "*");
    setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve(null);
    }, 1500);
  });
}

function applyContext(ctx) {
  state.docId = ctx.docId;
  state.docMeta = { title: ctx.title, type: ctx.type };
  state.context = ctx;
  state.unresolved = ctx.unresolved || [];
  $("panelDocTitle").textContent = ctx.title || "未命名";
  $("panelDocMeta").textContent = ctx.type ? `${ctx.type.toUpperCase()} · 第 ${ctx.page ?? 1} 页` : "";
  agent.setContext(ctx);
  $("ctxHint").textContent = ctx.pageText ? `已附带第 ${ctx.page} 页文本（${ctx.pageText.length} 字）` : "";
}

/* ---------------- 批注列表 ---------------- */

async function reload() {
  if (!state.docId) {
    $("annList").innerHTML = `<div class="empty">未检测到打开的文档。<br/>请在 PDF/网页上右键「用批注器打开」。</div>`;
    return;
  }
  state.annotations = await db.listAnnotations(state.docId);
  state.notes = await db.listNotes(state.docId);
  state.docMeta = (await db.getDocument(state.docId)) || state.docMeta;
  renderList();
  renderNotes();
}

function renderList() {
  const q = state.filter.trim().toLowerCase();
  const unresolved = new Set(state.unresolved || []);
  const list = state.annotations
    .filter((a) => !q || (a.quote || "").toLowerCase().includes(q) || (a.note || "").toLowerCase().includes(q))
    .sort((a, b) => (a.anchor?.page ?? 0) - (b.anchor?.page ?? 0));

  if (!list.length) {
    $("annList").innerHTML = `<div class="empty">还没有批注。在阅读器里选中文字即可添加。</div>`;
    return;
  }

  $("annList").replaceChildren(
    ...list.map((a) => {
      const el = document.createElement("div");
      el.className = "ann-item" + (unresolved.has(a.id) ? " unresolved" : "");
      const color = a.color || "#ffe680";
      el.innerHTML = `
        <div class="dot" style="background:${color}"></div>
        <div class="body">
          <div class="loc"></div>
          <div class="quote"></div>
          ${a.note ? `<div class="note"></div>` : ""}
        </div>
      `;
      el.querySelector(".loc").textContent = locatorLabel(a.anchor);
      el.querySelector(".quote").textContent = a.quote || "";
      if (a.note) el.querySelector(".note").textContent = a.note;
      el.addEventListener("click", () => jumpTo(a.id));
      return el;
    })
  );
}

function locatorLabel(an = {}) {
  if (an.kind === "pdf") return `第 ${an.page} 页`;
  if (an.kind === "epub") return `章节 ${(an.spineIndex ?? 0) + 1}`;
  if (an.kind === "web") return "正文";
  return "位置";
}

async function jumpTo(annotationId) {
  if (inIframe) {
    window.parent.postMessage({ type: MSG.READER_GOTO, payload: { annotationId } }, "*");
  } else if (state.readerTabId) {
    await sendToTab(state.readerTabId, { type: MSG.READER_GOTO, payload: { annotationId } });
  }
}

function renderNotes() {
  if (!state.notes.length) {
    $("noteList").innerHTML = `<div class="empty">还没有整页笔记。</div>`;
    return;
  }
  $("noteList").replaceChildren(
    ...state.notes.map((n) => {
      const el = document.createElement("div");
      el.className = "ann-item";
      el.innerHTML = `
        <div class="body">
          <div class="loc">${n.locator?.page ? "第 " + n.locator.page + " 页" : "整书"}</div>
          <div class="quote" style="white-space:pre-wrap;display:block"></div>
        </div>
      `;
      el.querySelector(".quote").textContent = n.body || "";
      el.addEventListener("dblclick", async () => {
        if (!confirm("删除这条笔记？")) return;
        await db.removeNote(n.id);
        await reload();
      });
      return el;
    })
  );
}

function bindNotesUI() {
  $("filterInput").addEventListener("input", (e) => {
    state.filter = e.target.value;
    renderList();
  });

  $("btnAddNote").addEventListener("click", async () => {
    if (!state.docId) return alert("先打开一个文档");
    const body = $("noteBody").value.trim();
    if (!body) return;
    const page = Number($("notePage").value) || null;
    await db.addNote({ docId: state.docId, body, locator: { page } });
    $("noteBody").value = "";
    await reload();
  });

  $("btnExportMd").addEventListener("click", async () => {
    const data = await exportData();
    downloadText(`${safeName(data.doc?.title || "doc")}.md`, exportMarkdown(data), "text/markdown");
  });

  $("btnExportJson").addEventListener("click", async () => {
    const data = await exportData();
    downloadText(`${safeName(data.doc?.title || "doc")}.json`, exportJson(data), "application/json");
  });
}

async function exportData() {
  if (!state.docId) {
    return {
      doc: { title: "empty" },
      annotations: [],
      notes: [],
    };
  }
  return {
    doc: (await db.getDocument(state.docId)) || {},
    annotations: await db.listAnnotations(state.docId),
    notes: await db.listNotes(state.docId),
  };
}

/* ---------------- Agent 聊天 ---------------- */

let chatBound = false;
function ensureChatBound() {
  if (chatBound) return;
  chatBound = true;
  bindChatUI();
}

function bindChatUI() {
  const input = $("chatInput");
  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    if (agent.busy) {
      renderChatMessage({ role: "tool", text: "上一条还在处理，先点「停止」或等它结束。" });
      return;
    }
    input.value = "";
    const attachPage = $("usePageText").checked;
    agent
      .ask(text, { attachPage })
      .catch((e) => renderChatMessage({ role: "assistant", text: "**出错了**：" + (e?.message || e) }));
  };
  $("btnSend").addEventListener("click", send);
  $("btnStop").addEventListener("click", () => agent.stop());
  $("btnClearChat").addEventListener("click", () => {
    agent.reset();
    $("chat").replaceChildren();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  agent.onStateChange = (s) => {
    $("btnStop").classList.toggle("hidden", !s.busy);
    $("btnSend").disabled = s.busy;
  };
}

function renderChatMessage({ role, text, html, streaming }) {
  ensureChatBound();
  const chat = $("chat");
  const last = chat.lastElementChild;
  // 流式过程中不断更新同一个气泡；流结束时也复用这一个，
  // 否则会出现「同样的回答显示两遍」。
  const canReuse = last && last.dataset.streaming === "1" && last.classList.contains(role);

  let el;
  if (canReuse) {
    el = last;
  } else {
    el = document.createElement("div");
    el.className = `msg ${role}`;
    el.innerHTML = `<div class="role"></div><div class="bubble"></div>`;
    el.querySelector(".role").textContent = roleLabel(role);
    chat.appendChild(el);
  }
  el.dataset.streaming = streaming ? "1" : "0";
  const bubble = el.querySelector(".bubble");
  if (html != null) {
    // 推理模型可能整段都是思考内容，被 stripThink 清空；给个占位提示
    bubble.innerHTML = html || (streaming ? '<span class="muted">（正在思考…）</span>' : "");
    bubble.classList.remove("plain");
  } else {
    bubble.textContent = text ?? "";
    bubble.classList.add("plain");
  }
  if (streaming) bubble.classList.add("cursor-blink");
  else bubble.classList.remove("cursor-blink");
  chat.scrollTop = chat.scrollHeight;
}

function roleLabel(role) {
  if (role === "user") return "你";
  if (role === "assistant") return vendorLabel;
  if (role === "tool") return "工具";
  return role;
}

/* ---------------- 消息 ---------------- */

function bindMessages() {
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === MSG.READER_READY) {
      if (Array.isArray(msg.payload?.unresolved)) state.unresolved = msg.payload.unresolved;
      reload();
      sendResponse({ ok: true });
    } else if (msg?.type === "annotations:changed") {
      reload();
      sendResponse({ ok: true });
    } else if (msg?.type === MSG.LLM_PREFILL) {
      openAgentWithPrefill(msg.payload);
      sendResponse({ ok: true });
    }
    return true;
  });

  // 内嵌模式：宿主通过 postMessage 推事件
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === MSG.READER_READY) {
      if (Array.isArray(msg.payload?.unresolved)) {
        state.unresolved = msg.payload.unresolved;
        renderList();
      }
      reload();
    }
    if (msg.type === "annotations:changed") reload();
    if (msg.type === MSG.LLM_PREFILL) openAgentWithPrefill(msg.payload);
  });
}

function openAgentWithPrefill(payload) {
  document.querySelector('.tab[data-tab="agent"]').click();
  const input = $("chatInput");
  input.value = payload?.prompt || "";
  if (payload?.context) {
    const ctx = { ...state.context, ...payload.context };
    agent.setContext(ctx);
  }
  input.focus();
}

/* ---------------- 工具 ---------------- */

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}
