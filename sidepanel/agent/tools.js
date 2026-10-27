// Agent 工具集（v1 只读 + 写笔记）。
// 每个工具都是 OpenAI function-calling 的 schema，执行逻辑在 runTool。

import * as db from "/shared/db.js";
import { MSG } from "/shared/messaging.js";
import { proxyToReader } from "../tool-proxy.js";

export const AGENT_TOOLS = [
  {
    name: "getCurrentPage",
    description: "读取当前页（或当前滚动位置所在页）的全文。用于回答关于眼前内容的问题。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "getSelection",
    description: "读取用户在阅读器里当前选中的文字。若没有选中则返回 null。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "getDocumentInfo",
    description: "读取当前文档的标题、类型、总页数、已打开的批注数量。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "getAnnotations",
    description: "读取当前文档的全部批注（含摘录与笔记）。",
    parameters: {
      type: "object",
      properties: {
        page: { type: "integer", description: "只看某一页，省略则返回全部" },
        limit: { type: "integer", description: "最多返回条数，默认 50" },
      },
      required: [],
    },
  },
  {
    name: "searchDocument",
    description: "在已加载的页面文本里搜索关键词，返回页码与上下文。仅能搜索已经渲染过的页。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "关键词或短语" },
        maxResults: { type: "integer", description: "最多返回条数，默认 10" },
      },
      required: ["query"],
    },
  },
  {
    name: "writeNote",
    description: "把一段笔记写入当前文档（独立于批注的整页/整书笔记）。写入前先向用户说明内容。",
    parameters: {
      type: "object",
      properties: {
        body: { type: "string", description: "笔记正文（Markdown）" },
        page: { type: "integer", description: "关联页码，可省略" },
      },
      required: ["body"],
    },
  },
];

// 预留：本版本未启用（agent.js 里有 gate）
AGENT_TOOLS.push(
  {
    name: "createHighlight",
    description: "【未启用】在指定位置创建高亮。",
    parameters: { type: "object", properties: { page: { type: "integer" }, quote: { type: "string" } }, required: ["page", "quote"] },
  },
  {
    name: "autoNotePage",
    description: "【未启用】对某一页自动生成笔记。",
    parameters: { type: "object", properties: { page: { type: "integer" } }, required: ["page"] },
  },
  {
    name: "autoNoteAll",
    description: "【未启用】对整篇文档逐页自动生成笔记。",
    parameters: { type: "object", properties: {}, required: [] },
  }
);

/**
 * @param {string} name
 * @param {object} args
 * @param {object} context 由 panel 从 reader 拿到的快照
 */
export async function runTool(name, args, context) {
  switch (name) {
    case "getCurrentPage": {
      if (!context?.pageText) return { page: context?.page, text: "", note: "当前页文本为空（可能是扫描版 PDF 或未渲染）" };
      return { page: context.page, text: truncate(context.pageText, 20000) };
    }
    case "getSelection": {
      const sel = await fetchSelection();
      return sel ? { text: sel } : { text: null };
    }
    case "getDocumentInfo": {
      const doc = context?.docId ? await db.getDocument(context.docId) : null;
      return {
        title: context?.title || doc?.title,
        type: context?.type || doc?.type,
        page: context?.page,
        annotations: context?.annotations?.length ?? 0,
      };
    }
    case "getAnnotations": {
      if (!context?.docId) return { annotations: [] };
      let list = context.annotations || [];
      if (!list.length) list = await db.listAnnotations(context.docId);
      if (args?.page) list = list.filter((a) => a.anchor?.page === args.page);
      const limit = Math.min(Number(args?.limit) || 50, 200);
      return {
        count: list.length,
        annotations: list.slice(0, limit).map((a) => ({
          page: a.anchor?.page,
          quote: truncate(a.quote, 300),
          note: a.note,
          color: a.color,
        })),
      };
    }
    case "searchDocument": {
      const q = String(args?.query || "").trim();
      if (!q) return { error: "query 不能为空" };
      const results = await searchInReader(q);
      return { query: q, results: results.slice(0, Math.min(Number(args?.maxResults) || 10, 30)) };
    }
    case "writeNote": {
      if (!context?.docId) return { error: "没有打开的文档" };
      const note = await db.addNote({
        docId: context.docId,
        body: String(args?.body || "").slice(0, 20000),
        locator: { page: args?.page ?? context.page ?? null },
      });
      return { ok: true, id: note.id };
    }
    default:
      return { error: `未知工具 ${name}` };
  }
}

/* ---------- 与阅读器交互 ---------- */

function readerRequest(msg, timeout = 3000) {
  return new Promise((resolve) => {
    // 内嵌 dock：直接问父窗口
    if (window.top !== window.self) {
      const handler = (e) => {
        const d = e.data;
        if (d?.type === MSG.TOOL_RESULT) {
          window.removeEventListener("message", handler);
          resolve(d.payload);
        }
      };
      window.addEventListener("message", handler);
      window.parent.postMessage(msg, "*");
      setTimeout(() => {
        window.removeEventListener("message", handler);
        resolve(null);
      }, timeout);
      return;
    }
    // side panel：走 tabs.sendMessage 直接问 reader tab
    resolve(proxyToReader(msg));
  });
}

async function fetchSelection() {
  const r = await readerRequest({ type: MSG.TOOL_SELECTION });
  return r?.text || null;
}

async function searchInReader(query) {
  const r = await readerRequest({ type: MSG.TOOL_SEARCH, payload: { query } }, 8000);
  return r?.results || [];
}

function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}
