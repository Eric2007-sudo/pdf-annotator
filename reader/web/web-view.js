// 网页视图：抓取到的正文 HTML 排版后，用「结构路径 + 字符偏移」锚定。
// 与 PDF 的区别：不做分页，只有一页连续的流。

import { selectorPathOf, resolveSelectorPath, normalizeQuote } from "/shared/model.js";

export class WebView {
  constructor(container, stage) {
    this.container = container;
    this.stage = stage;
    this.root = null;
    this.annotations = [];
    this._hlLayer = null;
  }

  async load(html, { baseUrl, plain = false } = {}) {
    this.container.replaceChildren();
    this.container.style.padding = "0";

    const wrap = document.createElement("div");
    wrap.className = "web-doc";
    this.container.appendChild(wrap);

    if (plain) {
      const pre = document.createElement("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.textContent = html;
      wrap.appendChild(pre);
    } else {
      const doc = new DOMParser().parseFromString(html, "text/html");

      // 去掉脚本与事件属性（防 XSS）
      doc.querySelectorAll("script,style,noscript,iframe,object,embed,form").forEach((n) => n.remove());
      for (const el of doc.querySelectorAll("*")) {
        for (const attr of [...el.attributes]) {
          if (/^on/i.test(attr.name) || (attr.name === "href" && /^javascript:/i.test(attr.value))) {
            el.removeAttribute(attr.name);
          }
        }
      }
      if (baseUrl) {
        const base = doc.createElement("base");
        base.href = baseUrl;
        doc.head?.appendChild(base);
      }

      // 优先抽取 article/main，退化为 body
      const main = doc.querySelector("article") || doc.querySelector("main") || doc.body;
      this.root = wrap;
      wrap.appendChild(document.importNode(main, true));
    }

    // 独立的高亮层
    const hl = document.createElement("div");
    hl.className = "web-hl-layer";
    wrap.style.position = "relative";
    wrap.appendChild(hl);
    this._hlLayer = hl;

    this.root = wrap;
  }

  /* ---------- 选区 ---------- */

  captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!this.root.contains(range.commonAncestorContainer)) return null;
    const text = normalizeQuote(range.toString());
    if (!text) return null;

    const start = this._startAnchor(range, text);
    return {
      quote: text,
      anchor: {
        kind: "web",
        selectorPath: start.selectorPath,
        textOffset: start.textOffset,
        quote: text,
        rects: this._rectsForRange(range),
      },
    };
  }

  /** 选区起点 -> 最近的文本节点 + 元素内字符偏移 + 元素路径 */
  _startAnchor(range, text) {
    let node = range.startContainer;
    let offset = range.startOffset;

    // 起点落在元素上：向后找第一个文本节点
    if (node.nodeType !== Node.TEXT_NODE) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const t = walker.nextNode();
      if (t && this.root.contains(t)) {
        node = t;
        offset = 0;
      } else {
        return { selectorPath: "", textOffset: 0 };
      }
    }

    let el = node.parentElement;
    while (el && el !== this.root && !el.textContent.includes(text.slice(0, 8))) {
      // 选中的文字跨了多个兄弟节点时，退到公共祖先
      el = el.parentElement;
    }
    if (!el || el === this.root) el = node.parentElement || this.root;

    const selectorPath = selectorPathOf(el, this.root);
    const within = textOffsetWithin(el, node, offset);
    return { selectorPath, textOffset: within };
  }

  _rectsForRange(range) {
    const base = this.root.getBoundingClientRect();
    const out = [];
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      out.push({
        x0: (r.left - base.left) / base.width,
        y0: (r.top - base.top) / base.height,
        x1: (r.right - base.left) / base.width,
        y1: (r.bottom - base.top) / base.height,
      });
    }
    return out;
  }

  clearSelection() {
    window.getSelection()?.removeAllRanges();
  }

  /* ---------- 高亮渲染 ---------- */

  setAnnotations(list) {
    this.annotations = list;
    this.render();
  }

  render() {
    if (!this._hlLayer) return;
    // 用 span 包裹一段文字来做高亮比较侵入，这里改用「叠加矩形」方案：
    // 每次滚动/缩放后按 anchor 重新定位。
    this._hlLayer.replaceChildren();
    for (const a of this.annotations) {
      if (a.anchor?.kind !== "web") continue;
      const range = this._resolveRange(a.anchor);
      if (!range) continue;
      const rects = range.getClientRects();
      const base = this.root.getBoundingClientRect();
      for (const r of rects) {
        if (r.width < 1) continue;
        const el = document.createElement("div");
        el.className = "web-hl";
        el.dataset.id = a.id;
        el.style.left = `${r.left - base.left}px`;
        el.style.top = `${r.top - base.top}px`;
        el.style.width = `${r.width}px`;
        el.style.height = `${r.height}px`;
        el.style.background = a.color || "#ffe680";
        this._hlLayer.appendChild(el);
      }
    }
  }

  /**
   * 把 anchor 还原成 DOM Range。
   * 思路：el 内文本 + 偏移定位起点，然后从起点往后按字符逐个「消费」quote
   * （跳过空白差异），终点落在消费完的最后一个字符上，跨节点也能正确还原。
   */
  _resolveRange(anchor) {
    const quote = anchor.quote || "";
    if (!quote) return null;
    const wanted = quote.replace(/\s+/g, "");

    let el = resolveSelectorPath(this.root, anchor.selectorPath);
    if (!el) el = this.root;

    // 收集 (textNode, 起点偏移)，从 anchor.textOffset 开始
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) nodes.push(t);

    let ni = 0;
    let startInNode = anchor.textOffset || 0;
    // 跳过 offset 之前的文本节点
    let acc = 0;
    for (; ni < nodes.length; ni++) {
      const len = nodes[ni].data.length;
      if (startInNode < acc + len) break;
      acc += len;
    }
    if (ni >= nodes.length) return null;
    startInNode -= acc;

    const startNode = nodes[ni];
    const startChar = this._firstMeaningful(startNode, startInNode);
    if (!startChar) return null;

    // 从起点开始匹配 wanted
    let matched = 0;
    let last = null;
    let node = startChar.node;
    let ci = startChar.offset;
    let guard = 0;
    while (node && matched < wanted.length && guard++ < 2_000_000) {
      const ch = node.data[ci];
      if (!/\s/.test(ch) && ch !== wanted[matched]) break; // 文本对不上，放弃
      if (!/\s/.test(ch)) {
        matched++;
        last = { node, offset: ci };
      }
      ci++;
      if (ci >= node.data.length) {
        node = this._nextTextNode(node);
        ci = 0;
      }
    }
    if (matched < wanted.length || !last) return null;

    const range = document.createRange();
    try {
      range.setStart(startChar.node, startChar.offset);
      range.setEnd(last.node, last.offset + 1);
    } catch {
      return null;
    }
    return range;
  }

  /** 从 (node, offset) 起找第一个非空白字符位置 */
  _firstMeaningful(node, offset) {
    // 起点前面全是空白时，往后跨节点找
    let n = node;
    let ci = offset;
    while (n) {
      const data = n.data;
      for (; ci < data.length; ci++) {
        if (!/\s/.test(data[ci])) return { node: n, offset: ci };
      }
      n = this._nextTextNode(n);
      ci = 0;
    }
    return null;
  }

  _nextTextNode(node) {
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    return walker.nextNode();
  }

  flashAnnotation(id) {
    const a = this.annotations.find((x) => x.id === id);
    if (!a) return;
    const range = this._resolveRange(a.anchor);
    const rect = range?.getBoundingClientRect();
    if (rect) this.stage.scrollTo({ top: this.stage.scrollTop + rect.top - 100, behavior: "smooth" });
  }

  getText() {
    return this.root?.innerText || "";
  }

  zoomIn() {
    this._zoom(1.1);
  }
  zoomOut() {
    this._zoom(1 / 1.1);
  }
  fitToWidth() {
    this.root.style.maxWidth = "100%";
  }
  _zoom(k) {
    const cur = parseFloat(this.root.style.zoom || "1");
    this.root.style.zoom = String(Math.max(0.5, Math.min(2.5, cur * k)));
    this.render();
  }
}

function textOffsetWithin(rootEl, node, offset) {
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let t;
  while ((t = walker.nextNode())) {
    if (t === node) return acc + offset;
    acc += t.data.length;
  }
  return acc;
}
