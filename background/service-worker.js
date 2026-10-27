// Service worker: 右键菜单、图标点击、tab 路由、消息中转。
// MV3 无状态：所有长期数据在 IndexedDB / chrome.storage。

const READER_PATH = "reader/reader.html";

/* ---------- 右键菜单 ---------- */

const MENUS = [
  { id: "open-pdf", title: "用批注器打开", contexts: ["link", "page"] },
  { id: "open-url", title: "用批注器打开链接…", contexts: ["link"] },
  { id: "open-selection", title: "用批注器阅读选中文字", contexts: ["selection"] },
];

async function ensureMenus() {
  await chrome.contextMenus.removeAll();
  for (const m of MENUS) chrome.contextMenus.create(m);
}

chrome.runtime.onInstalled.addListener(() => {
  ensureMenus();
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});
chrome.runtime.onStartup.addListener(ensureMenus);

/* ---------- 打开阅读器 ---------- */

function isPdfUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== "file:" && url.protocol !== "http:" && url.protocol !== "https:") return false;
    return /\.pdf($|[?#])/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

/**
 * 打开阅读器。
 * @param {{url?:string, text?:string, type?:'pdf'|'epub'|'web'|'text'}} target
 */
async function openReader(target) {
  const params = new URLSearchParams();
  if (target.url) params.set("src", target.url);
  if (target.type) params.set("type", target.type);
  if (target.text) {
    // 长文本走 storage，避免 URL 超长
    const key = "pendingText_" + Date.now();
    await chrome.storage.session.set({ [key]: target.text });
    params.set("pendingText", key);
  }
  const url = chrome.runtime.getURL(`${READER_PATH}?${params}`);
  const tab = await chrome.tabs.create({ url });
  return tab;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const pageUrl = info.pageUrl || tab?.url || "";
  switch (info.menuItemId) {
    case "open-pdf": {
      const target = info.linkUrl || pageUrl;
      if (isPdfUrl(target)) {
        await openReader({ url: target, type: "pdf" });
      } else {
        // 非 pdf：作为网页存档批注
        await openReader({ url: pageUrl, type: "web" });
      }
      break;
    }
    case "open-url": {
      const u = info.linkUrl;
      if (!u) return;
      const type = /\.epub($|[?#])/i.test(u) ? "epub" : isPdfUrl(u) ? "pdf" : "web";
      await openReader({ url: u, type });
      break;
    }
    case "open-selection": {
      if (!info.selectionText) return;
      await openReader({ url: pageUrl, type: "web", text: info.selectionText });
      break;
    }
  }
});

/* ---------- 快捷键：把当前标签页送进阅读器 ---------- */
// 本地 PDF 由 Edge 内置阅读器打开时，扩展右键菜单不会出现（浏览器限制），
// 快捷键是这条路径的可靠入口。

function typeOfUrl(u = "") {
  if (/\.epub($|[?#])/i.test(u)) return "epub";
  if (/\.pdf($|[?#])/i.test(u)) return "pdf";
  return "web";
}

chrome.commands?.onCommand.addListener(async (cmd) => {
  if (cmd !== "open-current-in-reader") return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const u = tab?.url || "";
  if (!/^(file|https?):/.test(u)) return;
  await openReader({ url: u, type: typeOfUrl(u) });
});

/* ---------- 图标点击：打开侧边栏 ---------- */chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab?.id;
  try {
    if (tabId != null) await chrome.sidePanel.open({ tabId });
    else await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    console.warn("sidePanel.open failed", e);
  }
});

/* ---------- 消息中转 ---------- */

/**
 * 页面 -> SW -> 阅读器 / 侧边栏
 * {type:'reader:open', payload:{url,type}}
 * {type:'panel:open'}  从阅读器里弹出侧边栏
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "reader:open":
          sendResponse({ ok: true, tab: await openReader(msg.payload || {}) });
          return;
        case "panel:open": {
          const tabId = sender.tab?.id;
          if (tabId != null) await chrome.sidePanel.open({ tabId });
          sendResponse({ ok: true });
          return;
        }
        case "ping":
          sendResponse({ ok: true, pong: true });
          return;
        case "llm:probe": {
          // 非流式探测（设置页「测试连接」）：同样由后台发，绕开 CORS
          try {
            const res = await fetch(msg.url, {
              headers: msg.headers || {},
              credentials: "omit",
              cache: "no-store",
            });
            const text = await res.text().catch(() => "");
            sendResponse({ ok: res.ok, status: res.status, body: text.slice(0, 6000) });
          } catch (e) {
            sendResponse({ ok: false, error: String(e?.message || e) });
          }
          return;
        }
        default:
          sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // async
});

/* ---------- LLM 代理 ---------- */
// 为什么放在后台：
//   - 扩展 Service Worker 有 host_permissions，跨域请求不受目标站点 CORS 限制，
//     因此 Ollama 不需要设 OLLAMA_ORIGINS（很多机器没有 sudo，改不动服务端）；
//   - key 不进入阅读器/面板的渲染逻辑，只有后台发请求时才用到。
// 流式：后台只负责搬运 SSE 原始文本，解析交给调用方。

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "llm") return;

  const ac = new AbortController();
  let closed = false;

  const send = (msg) => {
    if (closed) return;
    try {
      port.postMessage(msg);
    } catch {
      closed = true;
    }
  };

  port.onDisconnect.addListener(() => {
    closed = true;
    void chrome.runtime.lastError;
    ac.abort();
  });

  port.onMessage.addListener(async (msg) => {
    if (msg?.type === "abort") {
      ac.abort();
      return;
    }
    // 心跳：MV3 后台在 30 秒无事件时会被回收，模型加载期间可能一直没有数据，
    // 靠这条消息让后端保持存活。
    if (msg?.type === "ping") {
      send({ type: "pong" });
      return;
    }
    if (msg?.type !== "start") return;

    try {
      const resp = await fetch(msg.url, {
        method: "POST",
        headers: msg.headers || {},
        body: msg.body || "",
        signal: ac.signal,
        credentials: "omit",
        cache: "no-store",
      });

      if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => "");
        send({ type: "error", message: `HTTP ${resp.status} ${detail.slice(0, 400)}` });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        send({ type: "chunk", text: decoder.decode(value, { stream: true }) });
      }
      send({ type: "done" });
    } catch (e) {
      if (e?.name === "AbortError") send({ type: "aborted" });
      else send({ type: "error", message: String(e?.message || e) });
    }
  });
});

/* ---------- 启动时注册侧边栏可用性 ---------- */

chrome.runtime.onInstalled.addListener(async () => {
  // 侧边栏在所有标签页可用（阅读器内会读 query 恢复文档）
  try {
    await chrome.sidePanel.setOptions({ enabled: true, path: "sidepanel/sidepanel.html" });
  } catch {}
});
