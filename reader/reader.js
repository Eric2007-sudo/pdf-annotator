// 阅读器主控。
// 职责：加载文档 -> 选择视图（pdf / epub / web）-> 批注生命周期 -> 与侧边栏通信。

import { PdfView } from "./pdf/pdf-view.js";
import { EpubView } from "./epub/epub-view.js";
import { WebView } from "./web/web-view.js";
import { AnnPopover } from "./annotate/ann-popover.js";
import * as db from "/shared/db.js";
import { MSG } from "/shared/messaging.js";
import { exportMarkdown, exportJson, downloadText } from "/shared/export.js";

const $ = (id) => document.getElementById(id);

const els = {
  title: $("docTitle"),
  stage: $("stage"),
  container: $("pageContainer"),
  outline: $("outlineBody"),
  pageInput: $("pageInput"),
  pageCount: $("pageCount"),
  zoomLabel: $("zoomLabel"),
  errorBox: $("errorBox"),
  fileHint: $("fileHint"),
  dock: $("panelDock"),
  dockFrame: $("dockFrame"),
};

const state = {
  docId: null,
  docMeta: null,
  view: null,
  viewType: null,
  annotations: [],
  notes: [],
};

const popover = new AnnPopover();
const lastMouse = { x: 0, y: 0 };

main().catch(showError);

/* ---------------- 启动 ---------------- */

async function main() {
  bindToolbar();
  bindGlobalEvents();
  bindMessages();

  const params = new URLSearchParams(location.search);
  const src = params.get("src");
  const type = params.get("type") || guessType(src);
  const pendingKey = params.get("pendingText");

  if (pendingKey) return loadPendingText(pendingKey, src);
  if (!src) {
    // 没有指定来源：显示拖放区，让用户直接把文件拖进来
    showDropZone();
    return;
  }
  await loadSource(src, type);
}

/* ---------------- 本地文件（拖放 / 选择） ---------------- */

function showDropZone() {
  document.body.dataset.mode = "idle";
  const zone = $("dropZone");
  const input = $("fileInput");
  zone.classList.remove("hidden");
  els.title.textContent = "拖入文件开始批注";

  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) loadLocalFile(f);
  });

  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  zone.addEventListener("dragover", (e) => {
    stop(e);
    zone.classList.add("over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    stop(e);
    zone.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) loadLocalFile(f);
  });

  // 从桌面拖到窗口任意位置都算
  document.body.addEventListener("dragover", stop);
  document.body.addEventListener("drop", (e) => {
    stop(e);
    const f = e.dataTransfer?.files?.[0];
    if (f) loadLocalFile(f);
  });
}

async function loadLocalFile(file) {
  const type = guessType(file.name);
  if (type === "web") {
    showError(new Error(`不支持的文件类型：${file.name}\n只支持 .pdf 和 .epub`));
    return;
  }
  $("dropZone").classList.add("hidden");
  els.title.textContent = "加载中…";
  document.body.dataset.mode = "loading";
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // 本地文件没有可复用的 URL，用 名字+大小+修改时间 作为稳定标识
    await startWithBytes({
      bytes,
      type,
      srcKey: `local:${file.name}:${file.size}:${file.lastModified}`,
      title: file.name.replace(/\.(pdf|epub)$/i, ""),
      url: `file:///${file.name}`,
    });
  } catch (e) {
    showError(e);
  }
}

function guessType(u = "") {
  if (/\.pdf($|[?#])/i.test(u)) return "pdf";
  if (/\.epub($|[?#])/i.test(u)) return "epub";
  return "web";
}

/* ---------------- 加载 ---------------- */

async function loadSource(src, type) {
  els.title.textContent = "加载中…";
  document.body.dataset.mode = "loading";

  let bytes;
  try {
    bytes = await fetchBytes(src);
  } catch (e) {
    if (src.startsWith("file:")) {
      els.fileHint.classList.remove("hidden");
      els.title.textContent = "无法读取本地文件";
    } else {
      showError(e);
    }
    return;
  }

  await startWithBytes({
    bytes,
    type,
    srcKey: `${type}:${src}:${bytes.byteLength}`,
    title: fileNameOf(src) || "未命名",
    url: src,
  });
}

/**
 * 统一入口：字节 -> docId -> 挂载视图 -> 收尾。
 * @param {{bytes:Uint8Array, type:string, srcKey:string, title:string, url:string}} p
 */
async function startWithBytes({ bytes, type, srcKey, title, url }) {
  const docId = await sha256Hex(srcKey);
  state.docId = docId;
  state.viewType = type;
  document.body.dataset.view = type;

  state.docMeta = await db.upsertDocument({
    id: docId,
    type,
    title: title || "未命名",
    url,
    size: bytes.byteLength,
    page: 1,
  });
  els.title.textContent = state.docMeta.title;
  els.title.title = url;

  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  if (type === "pdf") await mountPdf(buf);
  else if (type === "epub") await mountEpub(buf);
  else await mountWeb(bytes, url);

  await finishLoad();
}

async function loadPendingText(key, src) {
  const obj = await chrome.storage.session.get(key);
  const text = obj?.[key] || "";
  await chrome.storage.session.remove(key).catch(() => {});
  const docId = await sha256Hex(`text:${src}:${text.length}`);
  state.docId = docId;
  state.viewType = "web";
  document.body.dataset.view = "web";
  state.docMeta = await db.upsertDocument({
    id: docId,
    type: "web",
    title: fileNameOf(src) || "网页快照",
    url: src,
  });
  els.title.textContent = state.docMeta.title;
  await mountWeb(new TextEncoder().encode(text), src, { plain: true });
  await finishLoad();
}

async function finishLoad() {
  state.annotations = await db.listAnnotations(state.docId);
  state.notes = await db.listNotes(state.docId);
  applyAnnotations();
  document.body.dataset.mode = "ready";
  if (state.docMeta.page > 1) setTimeout(() => goTo(state.docMeta.page), 200);
  notifyReady();
}

async function fetchBytes(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/* ---------------- 视图挂载 ---------------- */

async function mountPdf(arrayBuffer) {
  const view = new PdfView(els.container, els.stage);
  state.view = view;
  view.onPageChange = (n) => {
    els.pageInput.value = String(n);
    savePage(n);
  };
  const { numPages, title } = await view.load({ data: arrayBuffer });
  els.pageCount.textContent = `/ ${numPages}`;
  els.pageInput.max = String(numPages);
  updateZoomLabel();
  els.stage.addEventListener("scroll", () => view.updateCurrentPage(), { passive: true });
  view.updateCurrentPage();
  if (title) {
    state.docMeta = await db.upsertDocument({ ...state.docMeta, title });
    els.title.textContent = title;
  }
  const items = await view.getOutline();
  renderOutline(items, "pdf");
}

async function mountEpub(arrayBuffer) {
  const view = new EpubView(els.container, els.stage);
  state.view = view;
  view.setSelectionHandler(() => setTimeout(onTextSelected, 10));
  view._onHighlightClick = (id) => openAnnotationPopover(id, lastMouse.x, lastMouse.y);
  const { title } = await view.load(arrayBuffer, state.docId);
  if (title) {
    state.docMeta = await db.upsertDocument({ ...state.docMeta, title });
    els.title.textContent = title;
  }
  els.pageCount.textContent = "";
  renderOutline(view.getOutline(), "epub");
}

async function mountWeb(bytes, url, { plain = false } = {}) {
  const html = new TextDecoder("utf-8").decode(bytes);
  const view = new WebView(els.container, els.stage);
  state.view = view;
  await view.load(html, { baseUrl: url, plain });
  els.pageCount.textContent = "";
  renderOutline([{ title: "正文", href: null, depth: 0 }], "web");
}

/* ---------------- 目录 ---------------- */

function renderOutline(items, mode) {
  els.outline.replaceChildren();
  if (!items?.length) {
    els.outline.innerHTML = `<div style="padding:8px 12px;color:#9aa0a6">（无目录）</div>`;
    return;
  }
  for (const it of items) {
    const b = document.createElement("button");
    b.className = "outline-item";
    b.textContent = it.title || "（未命名）";
    b.dataset.depth = String(Math.min(3, it.depth || 0));
    b.addEventListener("click", () => {
      if (mode === "pdf" && it.page) goTo(it.page);
      else if (mode === "epub" && it.href) state.view.gotoHref(it.href);
      else state.stage.scrollTo({ top: 0, behavior: "smooth" });
    });
    els.outline.appendChild(b);
  }
}

/* ---------------- 选区与批注 ---------------- */

function bindGlobalEvents() {
  document.addEventListener("mousemove", (e) => {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
  }, { passive: true });

  document.addEventListener("mouseup", () => setTimeout(onTextSelected, 10));

  els.container.addEventListener("click", (e) => {
    const hl = e.target.closest?.(".hl");
    if (hl?.dataset.id) {
      const r = hl.getBoundingClientRect();
      openAnnotationPopover(hl.dataset.id, r.left + r.width / 2, r.bottom);
      return;
    }
    // PDF 的文字层在高亮层之上，点击落不到 .hl，用坐标反查
    const hit = state.view?.annotationAtPoint?.(e.clientX, e.clientY);
    if (hit) openAnnotationPopover(hit.id, e.clientX, e.clientY);
  });
}

function onTextSelected() {
  if (popover.el) return;
  const draft = state.view?.captureSelection?.();
  // 只选到空白 / 换行时不弹气泡（否则会出现「（无选中文字）」）
  if (!draft?.anchor || !draft.quote || !draft.quote.trim()) return;

  let x = lastMouse.x;
  let y = lastMouse.y;
  if (state.viewType === "pdf") {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) {
        x = r.left + r.width / 2;
        y = r.bottom;
      }
    }
  }

  popover.open({ x, y, quote: draft.quote, anchor: draft.anchor, mode: "create" });
}

function openAnnotationPopover(id, x, y) {
  const ann = state.annotations.find((a) => a.id === id);
  if (!ann) return;
  popover.open({
    x,
    y,
    id: ann.id,
    anchor: ann.anchor,
    quote: ann.quote,
    color: ann.color,
    note: ann.note,
    mode: "edit",
  });
}

popover.onSave = async ({ id, anchor, quote, color, note }) => {
  if (id) {
    const updated = await db.updateAnnotation(id, { color, note });
    state.annotations = state.annotations.map((a) => (a.id === id ? updated : a));
  } else {
    const created = await db.addAnnotation({ docId: state.docId, anchor, quote, color, note });
    state.annotations.push(created);
  }
  applyAnnotations();
  state.view?.clearSelection?.();
  broadcastChange();
};

popover.onDelete = async (id) => {
  await db.removeAnnotation(id);
  state.annotations = state.annotations.filter((a) => a.id !== id);
  applyAnnotations();
  broadcastChange();
};

popover.onAsk = async ({ quote, note, anchor }) => {
  await openPanel();
  setTimeout(() => {
    postToPanel({
      type: MSG.LLM_PREFILL,
      payload: {
        prompt: `请解释并分析这段文字：\n\n> ${quote}\n\n${note ? "我的笔记：" + note : ""}`,
        context: { docId: state.docId, title: state.docMeta?.title, page: anchor?.page },
      },
    });
  }, 300);
};

function applyAnnotations() {
  state.view?.setAnnotations?.(state.annotations);
}

function broadcastChange() {
  postToPanel({ type: "annotations:changed", payload: { docId: state.docId } });
}

/* ---------------- 工具栏 ---------------- */

function bindToolbar() {
  $("btnZoomIn").onclick = () => { state.view?.zoomIn?.(); updateZoomLabel(); };
  $("btnZoomOut").onclick = () => { state.view?.zoomOut?.(); updateZoomLabel(); };
  $("btnFitWidth").onclick = () => { state.view?.fitToWidth?.(); updateZoomLabel(); };

  $("btnPrev").onclick = () => goTo(Number(els.pageInput.value) - 1);
  $("btnNext").onclick = () => goTo(Number(els.pageInput.value) + 1);
  els.pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goTo(Number(els.pageInput.value));
  });

  $("btnExport").onclick = async () => {
    const fresh = {
      doc: state.docMeta,
      annotations: await db.listAnnotations(state.docId),
      notes: await db.listNotes(state.docId),
    };
    const md = exportMarkdown(fresh);
    downloadText(`${safeName(state.docMeta?.title || "doc")}.md`, md, "text/markdown");
  };

  $("btnSidebarToggle").onclick = () => {
    els.dock.hidden = !els.dock.hidden;
    if (!els.dock.hidden) ensureDockFrame();
  };

  $("btnOpenPanel").onclick = () => openPanel();

  $("btnUseDrop").onclick = () => {
    els.fileHint.classList.add("hidden");
    showDropZone();
  };
}

function updateZoomLabel() {
  const s = state.view?.scale;
  els.zoomLabel.textContent = s ? `${Math.round(s * 100)}%` : "";
}

function goTo(page) {
  if (!state.view) return;
  if (state.viewType === "pdf") {
    const n = Math.max(1, Math.min(Number(page) || 1, state.view.doc?.numPages || 1));
    state.view.scrollToPage(n);
    els.pageInput.value = String(n);
    savePage(n);
  }
}

let saveTimer = null;
function savePage(n) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!state.docId) return;
    state.docMeta = { ...state.docMeta, page: n };
    db.upsertDocument(state.docMeta).catch(() => {});
  }, 800);
}

/* ---------------- 面板通信 ---------------- */

function ensureDockFrame() {
  if (!els.dockFrame.src) els.dockFrame.src = chrome.runtime.getURL("sidepanel/sidepanel.html");
}

async function openPanel() {
  // 优先用真正的侧边栏；失败则退化为内嵌 dock
  try {
    const r = await chrome.runtime.sendMessage({ type: MSG.PANEL_OPEN });
    if (!r?.ok) throw new Error(r?.error || "panel open failed");
  } catch (e) {
    console.warn("side panel open failed, falling back to dock", e);
    els.dock.hidden = false;
    ensureDockFrame();
  }
}

function postToPanel(msg) {
  try {
    els.dockFrame?.contentWindow?.postMessage(msg, "*");
  } catch {}
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function bindMessages() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      switch (msg?.type) {
        case MSG.READER_CONTEXT:
          sendResponse(await buildContext());
          break;
        case MSG.READER_GOTO:
          state.view?.flashAnnotation?.(msg.payload?.annotationId);
          sendResponse({ ok: true });
          break;
        case MSG.TOOL_SELECTION: {
          const sel = window.getSelection()?.toString()?.trim() || "";
          sendResponse({ text: sel });
          break;
        }
        case MSG.TOOL_SEARCH:
          sendResponse({ results: await searchDocument(msg.payload?.query) });
          break;
        default:
          sendResponse({ ok: false, error: "unhandled" });
      }
    })();
    return true;
  });

  // 内嵌 dock 用 postMessage 通道
  window.addEventListener("message", async (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === MSG.READER_CONTEXT) {
      buildContext().then((ctx) => e.source?.postMessage({ type: MSG.READER_CONTEXT_RESULT, payload: ctx }, "*"));
    } else if (msg.type === MSG.READER_GOTO) {
      state.view?.flashAnnotation?.(msg.payload?.annotationId);
    } else if (msg.type === MSG.TOOL_SELECTION) {
      const sel = window.getSelection()?.toString()?.trim() || "";
      e.source?.postMessage({ type: MSG.TOOL_RESULT, payload: { text: sel } }, "*");
    } else if (msg.type === MSG.TOOL_SEARCH) {
      const results = await searchDocument(msg.payload?.query);
      e.source?.postMessage({ type: MSG.TOOL_RESULT, payload: { results } }, "*");
    }
  });
}

/** 在已渲染的页里搜关键词 */
async function searchDocument(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const out = [];
  if (state.viewType !== "pdf") {
    const text = state.view?.getText?.() || "";
    let from = 0;
    while (out.length < 20) {
      const idx = text.indexOf(q, from);
      if (idx < 0) break;
      out.push({ page: null, snippet: text.slice(Math.max(0, idx - 80), idx + q.length + 80).replace(/\s+/g, " ").trim() });
      from = idx + q.length;
    }
    return out;
  }
  for (const p of state.view.pages) {
    if (out.length >= 20) break;
    const text = state.view.getPageText(p.num);
    if (!text) continue;
    let from = 0;
    while (out.length < 20) {
      const idx = text.indexOf(q, from);
      if (idx < 0) break;
      out.push({
        page: p.num,
        snippet: text.slice(Math.max(0, idx - 60), idx + q.length + 60).replace(/\s+/g, " ").trim(),
      });
      from = idx + q.length;
    }
  }
  if (!out.length) {
    out.push({ page: null, snippet: "（只在已渲染过的页面中搜索。滚动浏览更多页面后重试，或先把文档整体翻一遍。）" });
  }
  return out;
}

async function buildContext() {
  const ctx = {
    docId: state.docId,
    type: state.viewType,
    title: state.docMeta?.title,
    page: state.view?.currentPage ?? 1,
    annotations: state.annotations.map((a) => ({
      id: a.id,
      page: a.anchor?.page,
      quote: a.quote,
      note: a.note,
      color: a.color,
    })),
    notes: state.notes.map((n) => ({ id: n.id, body: n.body })),
    pageText: "",
  };
  try {
    ctx.pageText =
      state.viewType === "pdf" ? await state.view.getCurrentPageText() : state.view?.getText?.() || "";
  } catch {}
  return ctx;
}

function notifyReady() {
  const unresolved = state.view?.findUnresolved?.() || [];
  chrome.runtime
    .sendMessage({
      type: MSG.READER_READY,
      payload: {
        docId: state.docId,
        type: state.viewType,
        title: state.docMeta?.title,
        page: state.view?.currentPage ?? 1,
        unresolved,
      },
    })
    .catch(() => {});
}

/* ---------------- 工具 ---------------- */

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fileNameOf(u = "") {
  try {
    return decodeURIComponent(new URL(u).pathname).split("/").pop() || "";
  } catch {
    return "";
  }
}

function safeName(s) {
  return s.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}

function showError(err) {
  els.errorBox.classList.remove("hidden");
  els.errorBox.textContent = String(err?.message || err);
  document.body.dataset.mode = "error";
  console.error(err);
}

/* 面板需要导出 JSON 时用 */
window.__exportJson = () => exportJson({ doc: state.docMeta, annotations: state.annotations, notes: state.notes });
window.__db = db;
