// 数据模型 + 锚定算法统一接口。
// 坐标约定：PDF 的 rect 全部归一化到页面 0..1（相对页宽/页高），与缩放、DPR 无关。

export const COLORS = {
  yellow: "#ffe680",
  green: "#b7f0a8",
  blue: "#a8d8f0",
  pink: "#f7b6d2",
  purple: "#d8c4f0",
};

export const DOC_TYPES = ["pdf", "epub", "web", "text"];

export function newDocId(type, sourceKey) {
  // sha256(type + ":" + sourceKey) 由调用方算，这里只做规整
  return `${type}:${sourceKey}`;
}

/* ---------------- PDF 锚定 ---------------- */

/**
 * PDF anchor:
 * {
 *   kind: 'pdf',
 *   page: 1-based,
 *   quote: 选中的纯文本（归一化空白，最长 200 字）
 *   startOffset, endOffset,   // 该页文本层拼接后的字符区间（用于快速定位）
 *   rects: [{x0,y0,x1,y1}],   // 归一化坐标，同一页内可能有多个（跨行）
 * }
 */

export function normalizeQuote(s) {
  return (s || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * 从一个字符区间 [start,end) 计算归一化 rectangles。
 * @param {Range} range        DOM Range（跨行时 getClientRects 返回多块）
 * @param {DOMRect} pageRect   该页容器（.page）的 rect
 */
export function rectsFromRange(range, pageRect) {
  const out = [];
  // 逐行处理：先用 getClientRects 拿行框，再在其中用二分找字符区间，得到行内精确范围
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
  for (const r of rects) {
    out.push({
      x0: clamp01((r.left - pageRect.left) / pageRect.width),
      y0: clamp01((r.top - pageRect.top) / pageRect.height),
      x1: clamp01((r.right - pageRect.left) / pageRect.width),
      y1: clamp01((r.bottom - pageRect.top) / pageRect.height),
    });
  }
  return mergeRects(out);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** 合并同一行里被拆开的碎块（间距 < 0.3% 页宽） */
export function mergeRects(rects) {
  if (!rects.length) return [];
  const sorted = [...rects].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const merged = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    const sameLine = last && Math.abs(last.y0 - r.y0) < 0.01 && Math.abs(last.y1 - r.y1) < 0.01;
    if (sameLine && r.x0 - last.x1 < 0.004) {
      last.x1 = Math.max(last.x1, r.x1);
      last.x0 = Math.min(last.x0, r.x0);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * 在整页文本里根据 quote 做兜底定位，返回 rects。
 * @param {string} pageText
 * @param {string} quote
 * @param {Map<number, DOMRect>} charRects 字符index -> 它的 client rect（由 textLayer 预先算好）
 */
export function locateByQuote(pageText, quote, startOffset, charRects) {
  const norm = normalizeQuote(pageText);
  if (!norm || !quote) return null;
  let idx = -1;
  if (typeof startOffset === "number" && startOffset >= 0) {
    const around = norm.indexOf(quote, Math.max(0, startOffset - quote.length * 2));
    if (around >= 0) idx = around;
  }
  if (idx < 0) idx = norm.indexOf(quote);
  if (idx < 0) return null;
  return { startOffset: idx, endOffset: idx + quote.length };
}

/* ---------------- EPUB 锚定 ---------------- */

/** EPUB anchor: {kind:'epub', cfi, quote, spineIndex} */
export function epubAnchor(cfi, quote, spineIndex) {
  return { kind: "epub", cfi, quote: normalizeQuote(quote), spineIndex };
}

/* ---------------- 网页锚定 ---------------- */

/**
 * 网页 anchor: {kind:'web', selectorPath, textOffset, quote}
 * selectorPath 是自 root 起、每级 (tag + nth-of-type) 的路径串。
 */
export function selectorPathOf(node, root) {
  const parts = [];
  let el = node.nodeType === 1 ? node : node.parentElement;
  while (el && el !== root && el.parentElement) {
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    let idx = 1;
    for (const sib of parent.children) {
      if (sib === el) break;
      if (sib.tagName === el.tagName) idx++;
    }
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    el = parent;
  }
  return parts.join(">");
}

export function resolveSelectorPath(root, path) {
  if (!path) return null;
  let el = root;
  for (const part of path.split(">")) {
    const m = part.match(/^([a-z0-9]+):nth-of-type\((\d+)\)$/);
    if (!m) return null;
    const candidates = el.querySelectorAll(`:scope > ${m[1]}`);
    el = candidates[Number(m[2]) - 1];
    if (!el) return null;
  }
  return el;
}

export function webAnchor(node, root, offsetInNode, quote) {
  return {
    kind: "web",
    selectorPath: selectorPathOf(node, root),
    textOffset: Math.max(0, offsetInNode | 0),
    quote: normalizeQuote(quote),
  };
}
