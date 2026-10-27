// 文字层映射：把 DOM 里的字符顺序映射为「整页字符串下标」。
// 契约：
//   pageText  = 该页文字层所有文本节点按 DOM 顺序拼接（<br> 记作一个空格）
//   charMap[i] = {node, offset} —— pageText[i] 对应的 DOM 位置；分隔符为 null
//   nodeStart  = Map<Text, number> —— 文本节点在 pageText 里的起始下标
// offset 是「边界下标」，取值 0..pageText.length，可直接用于 Range 还原。

/** @param {HTMLElement} textLayerDiv */
export function buildCharMap(textLayerDiv) {
  const charMap = [];
  const nodeStart = new Map();
  let pageText = "";

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        nodeStart.set(child, pageText.length);
        const data = child.data;
        for (let i = 0; i < data.length; i++) charMap.push({ node: child, offset: i });
        pageText += data;
      } else if (child.nodeName === "BR") {
        charMap.push(null);
        pageText += " ";
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(textLayerDiv);

  return { pageText, charMap, nodeStart };
}

/** 文本节点内的 (node, offset) -> pageText 边界下标；失败返回 -1 */
function boundaryIndex(mapping, node, offset) {
  const { nodeStart, pageText } = mapping;

  if (node.nodeType === Node.TEXT_NODE) {
    const base = nodeStart.get(node);
    if (base === undefined) return -1;
    return base + Math.max(0, Math.min(offset, node.data.length));
  }

  // Range 端点落在元素上（例如点在一行末尾空白处）
  if (node.nodeType !== Node.ELEMENT_NODE) return -1;
  const children = node.childNodes;
  if (!children.length) return -1;

  // 优先：offset 指向的那个子节点
  const pick = (el) => {
    // 取该子树里第一个/最后一个文本节点
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const t = walker.nextNode();
    return t && nodeStart.has(t) ? t : null;
  };

  if (offset < children.length) {
    const child = children[offset];
    if (child.nodeType === Node.TEXT_NODE && nodeStart.has(child)) return nodeStart.get(child);
    const t = pick(child);
    if (t) return nodeStart.get(t);
  }
  // 回退：往前找最近的文本节点，取它的末尾
  for (let i = Math.min(offset, children.length) - 1; i >= 0; i--) {
    const child = children[i];
    if (child.nodeType === Node.TEXT_NODE && nodeStart.has(child)) {
      return nodeStart.get(child) + child.data.length;
    }
    const t = pick(child);
    if (t) return nodeStart.get(t) + t.data.length;
  }
  return pageText.length;
}

/** DOM Range -> pageText 的 [start, end) */
export function rangeToOffsets(range, mapping) {
  if (!mapping?.charMap.length) return null;
  let start = boundaryIndex(mapping, range.startContainer, range.startOffset);
  let end = boundaryIndex(mapping, range.endContainer, range.endOffset);
  if (start < 0 || end < 0) return null;
  if (start > end) [start, end] = [end, start];
  if (start === end) return null;
  return { startOffset: start, endOffset: end };
}

/** pageText 的下标区间 -> DOM Range（自动跳过换行分隔符） */
export function offsetsToRange(startOffset, endOffset, mapping) {
  const { charMap } = mapping;
  if (!charMap.length) return null;

  const clamp = (n) => Math.max(0, Math.min(n, charMap.length));
  let s = clamp(startOffset);
  let e = clamp(endOffset);

  const firstNode = (from, to, step) => {
    for (let i = from; step > 0 ? i < to : i >= to; i += step) {
      const c = charMap[i];
      if (c?.node) return c;
    }
    return null;
  };

  const sChar = firstNode(s, e, 1);
  const eChar = firstNode(e - 1, s - 1, -1);
  if (!sChar || !eChar) return null;

  const range = document.createRange();
  try {
    range.setStart(sChar.node, sChar.offset);
    // 终点是「最后一个字符之后」
    range.setEnd(eChar.node, eChar.offset + 1);
  } catch {
    return null;
  }
  return range;
}

/**
 * 空白归一化，并记录每个归一化字符对应的原始下标。
 * 用于「存的是归一化 quote、但要在原始 pageText 里找位置」。
 */
export function normalizeWithMap(pageText) {
  const out = [];
  const map = [];
  let lastSpace = false;
  for (let i = 0; i < pageText.length; i++) {
    const ch = pageText[i];
    if (/\s/.test(ch)) {
      if (!lastSpace && out.length) {
        out.push(" ");
        map.push(i);
        lastSpace = true;
      }
      continue;
    }
    out.push(ch);
    map.push(i);
    lastSpace = false;
  }
  while (out.length && out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }
  return { text: out.join(""), map };
}

/** 在 pageText 里找 quote，返回原始下标区间 */
export function findQuote(pageText, quote) {
  if (!quote) return null;
  const { text, map } = normalizeWithMap(pageText);
  const q = quote.replace(/\s+/g, " ").trim();
  if (!q) return null;
  const idx = text.indexOf(q);
  if (idx < 0) return null;
  const start = map[idx];
  const end = map[idx + q.length - 1] + 1;
  return { startOffset: start, endOffset: end };
}

export function extractSelectionText(range) {
  return range.toString().replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
}

/** 选区是否落在文字层内 */
export function selectionWithin(container) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  if (!range.toString().trim()) return null;
  return range;
}

export function clearSelection() {
  window.getSelection()?.removeAllRanges();
}
