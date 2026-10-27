// 导出：单文档 Markdown / 全库 JSON，以及触发下载。
// Markdown 结构固定，便于 Obsidian / Typora 直接打开。

import { COLORS } from "./model.js";

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function colorName(c) {
  return Object.keys(COLORS).find((k) => COLORS[k] === c) || c || "yellow";
}

/**
 * @param {{doc:object, annotations:object[], notes:object[]}} data
 */
export function exportMarkdown({ doc, annotations = [], notes = [] }) {
  const lines = [];
  const title = doc?.title || "未命名文档";
  lines.push(`# ${title}`, "");

  const meta = [
    doc?.type && `类型: ${doc.type}`,
    doc?.url && `来源: ${doc.url}`,
    doc?.size && `大小: ${(doc.size / 1024 / 1024).toFixed(2)} MB`,
    `批注: ${annotations.length} 条`,
    `导出时间: ${fmtTime(Date.now())}`,
  ].filter(Boolean);
  lines.push(...meta.map((m) => `- ${m}`), "");

  if (annotations.length) {
    lines.push("## 批注", "");
    const sorted = [...annotations].sort(byPosition);
    for (const a of sorted) {
      lines.push(`### ${locatorLabel(a)}`, "");
      if (a.quote) {
        for (const l of a.quote.split(/\n/)) lines.push(`> ${l}`);
        lines.push("");
      }
      if (a.note) lines.push(a.note, "");
      const tags = a.tags?.length ? `  标签: ${a.tags.join(", ")}` : "";
      lines.push(`<sub>${colorName(a.color)} · ${fmtTime(a.createdAt)}${tags}</sub>`, "");
    }
  }

  if (notes.length) {
    lines.push("## 笔记", "");
    for (const n of notes) {
      const loc = n.locator?.page ? ` (第 ${n.locator.page} 页)` : "";
      lines.push(`### 笔记${loc}`, "", n.body || "", "");
    }
  }
  return lines.join("\n");
}

function byPosition(a, b) {
  const pa = a.anchor?.page ?? a.anchor?.spineIndex ?? 0;
  const pb = b.anchor?.page ?? b.anchor?.spineIndex ?? 0;
  return pa - pb || (a.anchor?.startOffset ?? 0) - (b.anchor?.startOffset ?? 0);
}

function locatorLabel(a) {
  const an = a.anchor || {};
  if (an.kind === "pdf") return `第 ${an.page} 页`;
  if (an.kind === "epub") return `章节 ${(an.spineIndex ?? 0) + 1}`;
  if (an.kind === "web") return "正文";
  return "位置";
}

export function exportJson({ doc, annotations, notes }) {
  return JSON.stringify(
    { exportVersion: 1, exportedAt: new Date().toISOString(), doc, annotations, notes },
    null,
    2
  );
}

export function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
