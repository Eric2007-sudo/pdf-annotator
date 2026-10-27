// PDF 视图：pdf.js 渲染 + 虚拟滚动 + 文字层 + 高亮层。
// 只渲染视口内的页面（±2 页），其余用占位 div 撑高度。

import * as pdfjsLib from "/vendor/pdfjs/pdf.mjs";
import { buildCharMap, rangeToOffsets, offsetsToRange, extractSelectionText, selectionWithin, clearSelection, findQuote } from "./text-layer.js";
import { rectsFromRange, normalizeQuote, mergeRects } from "/shared/model.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("/vendor/pdfjs/pdf.worker.mjs", location.href).href;

const SCALE_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export class PdfView {
  /**
   * @param {HTMLElement} container  .page-container
   * @param {HTMLElement} stage      滚动容器
   */
  constructor(container, stage) {
    this.container = container;
    this.stage = stage;
    this.doc = null;
    this.pages = []; // {num, div, canvasWrap, textDiv, hlDiv, viewport, rendered, rendering, baseW, baseH}
    this.scale = 1;
    this.fitWidth = true;
    this.onPageChange = () => {};
    this.onSelection = () => {};
    this.annotations = []; // 当前文档所有批注
    this.mappingCache = new Map(); // page -> {pageText, charMap}
    this.observer = null;
    this.currentPage = 1;
  }

  async load(source) {
    this.destroy();
    const loadingTask = pdfjsLib.getDocument({
      ...source, // {url} 或 {data}
      cMapUrl: new URL("/vendor/pdfjs/cmaps/", location.href).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("/vendor/pdfjs/standard_fonts/", location.href).href,
      isEvalSupported: false,
    });
    this.doc = await loadingTask.promise;
    const title = await this._getTitle();
    await this._buildPlaceholders();
    this.scale = this._fitScale();
    await this._relayout();
    return { numPages: this.doc.numPages, title };
  }

  async _getTitle() {
    try {
      const meta = await this.doc.getMetadata();
      return meta?.info?.Title || "";
    } catch {
      return "";
    }
  }

  async _buildPlaceholders() {
    this.container.replaceChildren();
    this.pages = [];
    // 用第一页宽高作为所有页的占位高度基准
    const p1 = await this.doc.getPage(1);
    const vp1 = p1.getViewport({ scale: 1 });
    this.base1 = { w: vp1.width, h: vp1.height };

    for (let i = 1; i <= this.doc.numPages; i++) {
      const div = document.createElement("div");
      div.className = "page";
      div.dataset.page = String(i);
      div.style.width = `${this.base1.w}px`;
      div.style.height = `${this.base1.h}px`;
      div.style.contain = "layout paint";
      div.innerHTML = `<div class="hlLayer"></div>`;
      this.container.appendChild(div);
      this.pages.push({ num: i, div, rendered: false, rendering: null, vp: null });
    }
  }

  _fitScale() {
    const w = this.stage.clientWidth - 48;
    if (this.fitWidth) return Math.max(0.25, w / this.base1.w);
    return this.scale;
  }

  async _relayout() {
    if (!this.doc) return;
    const anchorPage = this.currentPage;
    const scrollRatio = this._scrollRatioWithin(anchorPage);
    this.scale = this.fitWidth ? this._fitScale() : this.scale;

    for (const p of this.pages) {
      const vp = (await this.doc.getPage(p.num)).getViewport({ scale: this.scale });
      p.vp = vp;
      p.div.style.width = `${vp.width}px`;
      p.div.style.height = `${vp.height}px`;
      if (p.rendered) {
        p.rendered = false;
        p.div.replaceChildren(Object.assign(document.createElement("div"), { className: "hlLayer" }));
      }
    }
    this.mappingCache.clear();
    this._attachObserver();
    // 保持阅读位置
    const target = this.pages[anchorPage - 1];
    if (target) this.stage.scrollTop = target.div.offsetTop + scrollRatio * target.div.offsetHeight - 8;
    this.renderVisible();
    this.updateCurrentPage();
  }

  _scrollRatioWithin(num) {
    const p = this.pages[num - 1];
    if (!p || !p.div.offsetHeight) return 0;
    return Math.max(0, Math.min(1, (this.stage.scrollTop - p.div.offsetTop) / p.div.offsetHeight));
  }

  _attachObserver() {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const num = Number(e.target.dataset.page);
          if (e.isIntersecting) this.renderPage(num);
        }
      },
      { root: this.stage, rootMargin: "150% 0px" }
    );
    for (const p of this.pages) this.observer.observe(p.div);
  }

  renderVisible() {
    const top = this.stage.scrollTop;
    const bottom = top + this.stage.clientHeight;
    for (const p of this.pages) {
      const t = p.div.offsetTop;
      const b = t + p.div.offsetHeight;
      if (b > top - this.stage.clientHeight && t < bottom + this.stage.clientHeight) this.renderPage(p.num);
    }
  }

  async renderPage(num) {
    const p = this.pages[num - 1];
    if (!p || p.rendered) return;
    if (p.rendering) return p.rendering;

    p.rendering = (async () => {
      const page = await this.doc.getPage(num);
      const vp = page.getViewport({ scale: this.scale });
      const dpr = window.devicePixelRatio || 1;

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;

      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.scale(dpr, dpr);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const textDiv = document.createElement("div");
      textDiv.className = "textLayer";
      textDiv.dataset.page = String(num);
      textDiv.style.setProperty("--scale-factor", String(this.scale));

      const hlDiv = document.createElement("div");
      hlDiv.className = "hlLayer";

      p.div.replaceChildren(canvas, textDiv, hlDiv);
      p.canvas = canvas;
      p.textDiv = textDiv;
      p.hlDiv = hlDiv;
      p.vp = vp;
      p.page = page;

      // 用 pdf.js 官方 TextLayer：矩阵、字距、换行、旋转都由它处理
      const textContent = await page.getTextContent();
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textDiv, viewport: vp });
      await textLayer.render();
      p.textLayer = textLayer;

      this.mappingCache.set(num, buildCharMap(textDiv));

      p.rendered = true;
      this.drawHighlightsForPage(num);
    })();

    try {
      await p.rendering;
    } finally {
      p.rendering = null;
    }
  }

  /* ---------------- 高亮 ---------------- */

  setAnnotations(list) {
    this.annotations = list;
    this.rerenderAllHighlights();
  }

  rerenderAllHighlights() {
    for (const p of this.pages) {
      if (p.rendered) this.drawHighlightsForPage(p.num);
    }
  }

  /** 当前缩放下的单页尺寸（PDF 用户空间 -> CSS px） */
  get pageSize() {
    const p = this.pages[0];
    if (p?.vp) return { width: p.vp.width, height: p.vp.height };
    return { width: this.base1.w, height: this.base1.h };
  }

  /**
   * 哪些批注在当前文档里找不到原文（需要用户手动确认）。
   * 只对已渲染的页做判断，未渲染的页视为"未知"。
   */
  findUnresolved() {
    const out = [];
    for (const a of this.annotations) {
      const an = a.anchor;
      if (an?.kind !== "pdf") continue;
      const p = this.pages[an.page - 1];
      if (!p?.rendered) continue;
      const mapping = this.mappingCache.get(p.num);
      if (!mapping) continue;
      const hit =
        (typeof an.startOffset === "number" &&
          normalizeQuote(mapping.pageText.slice(an.startOffset, an.endOffset)) === an.quote) ||
        !!findQuote(mapping.pageText, an.quote);
      if (!hit) out.push(a.id);
    }
    return out;
  }

  drawHighlightsForPage(num) {
    const p = this.pages[num - 1];
    if (!p?.rendered) return;
    const hlDiv = p.hlDiv;
    const frag = document.createDocumentFragment();

    const anns = this.annotations.filter((a) => a.anchor?.kind === "pdf" && a.anchor.page === num);
    for (const a of anns) {
      const rects = this._resolveRects(a, p);
      if (!rects || !rects.length) continue;
      for (const r of rects) {
        const el = document.createElement("div");
        el.className = "hl";
        el.dataset.id = a.id;
        el.style.left = `${r.x0 * 100}%`;
        el.style.top = `${r.y0 * 100}%`;
        el.style.width = `${(r.x1 - r.x0) * 100}%`;
        el.style.height = `${(r.y1 - r.y0) * 100}%`;
        el.style.background = a.color || "#ffe680";
        frag.appendChild(el);
      }
    }
    hlDiv.replaceChildren(frag);
  }

  /** @returns {Array|null} 归一化 rects */
  _resolveRects(a, p) {
    const anchor = a.anchor;
    const mapping = this.mappingCache.get(p.num);
    if (mapping) {
      let range = null;
      if (typeof anchor.startOffset === "number") {
        range = offsetsToRange(anchor.startOffset, anchor.endOffset, mapping);
        if (range && normalizeQuote(range.toString()) !== anchor.quote) range = null;
      }
      if (!range && anchor.quote) {
        const found = findQuote(mapping.pageText, anchor.quote);
        if (found) range = offsetsToRange(found.startOffset, found.endOffset, mapping);
      }
      if (range) {
        const pageRect = p.div.getBoundingClientRect();
        const rects = rectsFromRange(range, pageRect);
        if (rects.length) return mergeRects(rects);
      }
    }
    return anchor.rects || null;
  }

  /* ---------------- 选区 -> 锚点 ---------------- */

  /**
   * 读取当前选区，返回 {anchor, text, pageNum} 或 null。
   */
  captureSelection() {
    for (const p of this.pages) {
      if (!p.rendered || !p.textDiv) continue;
      const range = selectionWithin(p.textDiv);
      if (!range) continue;
      const mapping = this.mappingCache.get(p.num);
      if (!mapping) continue;
      const offs = rangeToOffsets(range, mapping);
      if (!offs) continue;
      const pageRect = p.div.getBoundingClientRect();
      const rects = rectsFromRange(range, pageRect);
      return {
        pageNum: p.num,
        text: extractSelectionText(range),
        anchor: {
          kind: "pdf",
          page: p.num,
          quote: normalizeQuote(range.toString()),
          startOffset: offs.startOffset,
          endOffset: offs.endOffset,
          rects: mergeRects(rects),
        },
      };
    }
    return null;
  }

  getPageText(num) {
    const m = this.mappingCache.get(num);
    return m ? m.pageText : "";
  }

  /** 当前页的可读文本（给 LLM 用） */
  async getCurrentPageText() {
    const num = this.currentPage;
    if (!this.mappingCache.has(num)) await this.renderPage(num);
    return this.getPageText(num).replace(/[ \t]+/g, " ");
  }

  /* ---------------- 导航 ---------------- */

  async scrollToPage(num, { flash = false } = {}) {
    const p = this.pages[num - 1];
    if (!p) return;
    this.stage.scrollTo({ top: p.div.offsetTop - 8, behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 300));
    await this.renderPage(num);
    if (flash) {
      const first = p.hlDiv?.querySelector(".hl");
      if (first) {
        first.classList.add("flash");
        setTimeout(() => first.classList.remove("flash"), 1300);
      }
    }
  }

  flashAnnotation(id) {
    const ann = this.annotations.find((a) => a.id === id);
    if (!ann) return;
    const page = ann.anchor?.page || 1;
    this.scrollToPage(page).then(() => {
      const el = this.pages[page - 1]?.hlDiv?.querySelector(`.hl[data-id="${id}"]`);
      if (el) {
        el.classList.add("flash", "active");
        setTimeout(() => el.classList.remove("flash"), 1300);
      }
    });
  }

  setScale(next) {
    this.fitWidth = false;
    this.scale = Math.max(0.25, Math.min(4, next));
    this._relayout();
  }

  zoomIn() {
    const i = SCALE_STEPS.findIndex((s) => s > this.scale + 0.001);
    this.setScale(i >= 0 ? SCALE_STEPS[i] : this.scale * 1.2);
  }

  zoomOut() {
    const rev = [...SCALE_STEPS].reverse();
    const i = rev.findIndex((s) => s < this.scale - 0.001);
    this.setScale(i >= 0 ? rev[i] : this.scale / 1.2);
  }

  fitToWidth() {
    this.fitWidth = true;
    this._relayout();
  }

  updateCurrentPage() {
    const st = this.stage.scrollTop + this.stage.clientHeight * 0.3;
    let best = 1;
    for (const p of this.pages) {
      if (p.div.offsetTop <= st) best = p.num;
      else break;
    }
    if (best !== this.currentPage) {
      this.currentPage = best;
      this.onPageChange(best);
    }
  }

  /* ---------------- 点击命中 ---------------- */

  /** 元素上/下是否有批注：把坐标换算成页内归一化坐标后判断 */
  annotationAtPoint(clientX, clientY) {
    for (const p of this.pages) {
      if (!p.rendered) continue;
      const box = p.div.getBoundingClientRect();
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue;
      const nx = (clientX - box.left) / box.width;
      const ny = (clientY - box.top) / box.height;
      const anns = this.annotations.filter((a) => a.anchor?.kind === "pdf" && a.anchor.page === p.num);
      for (const a of anns) {
        const rects = this._resolveRects(a, p) || [];
        for (const r of rects) {
          if (nx >= r.x0 - 0.002 && nx <= r.x1 + 0.002 && ny >= r.y0 - 0.002 && ny <= r.y1 + 0.002) return a;
        }
      }
      return null;
    }
    return null;
  }

  get documentTitle() {
    return this.title || "";
  }

  async getOutline() {
    if (!this.doc) return [];
    const raw = await this.doc.getOutline();
    if (!raw) return [];
    const out = [];
    const walk = async (items, depth = 0) => {
      for (const it of items) {
        let page = null;
        try {
          let dest = it.dest;
          if (typeof dest === "string") dest = await this.doc.getDestination(dest);
          if (Array.isArray(dest) && dest[0] != null) {
            const ref = dest[0];
            const idx = typeof ref === "object" ? await this.doc.getPageIndex(ref) : ref;
            page = idx + 1;
          }
        } catch {
          page = null;
        }
        out.push({ title: it.title, page, depth });
        if (it.items?.length) await walk(it.items, depth + 1);
      }
    };
    await walk(raw);
    return out;
  }

  clearSelection() {
    clearSelection();
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.doc) {
      this.doc.destroy?.();
      this.doc = null;
    }
    this.pages = [];
    this.mappingCache.clear();
    this.container.replaceChildren();
  }
}

/** 轮询等待条件成立，超时返回 false */
function waitFor(pred, timeout = 1000, step = 16) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (pred()) return resolve(true);
      if (performance.now() - t0 > timeout) return resolve(false);
      setTimeout(tick, step);
    };
    tick();
  });
}
