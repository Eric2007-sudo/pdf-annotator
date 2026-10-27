// EPUB 视图：基于 epub.js。
// 注：epub.js 用 iframe 渲染章节，跨 iframe 选区由 epub.js 的 rendition.on("selected") 提供 CFI，可直接作为锚点。

import { normalizeQuote } from "/shared/model.js";

export class EpubView {
  constructor(container, stage) {
    this.container = container;
    this.stage = stage;
    this.book = null;
    this.rendition = null;
    this.annotations = [];
    this.currentHref = null;
    this._highlights = new Map(); // id -> {cfiRange, sectionIndex, hl}
  }

  async load(bytes, docId) {
    this.docId = docId;
    this.container.replaceChildren();

    const host = document.createElement("div");
    host.className = "epub-view";
    this.container.appendChild(host);
    this.container.style.padding = "0";

    this.book = window.ePub(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    const meta = this.book.packaging?.metadata || {};
    const title = meta.title || "";

    this.rendition = this.book.renderTo(host, {
      width: "100%",
      height: "100%",
      flow: "scrolled-doc",
      spread: "none",
      allowScriptedContent: false,
    });

    await this.rendition.display();

    this.rendition.on("selected", (cfiRange, contents) => {
      try {
        const text = contents.window.getSelection()?.toString() || "";
        if (!text.trim()) return;
        this._lastSelection = { cfiRange, text: normalizeQuote(text) };
        this._onSelection?.(this._lastSelection);
      } catch {}
    });

    this.rendition.on("relocated", (loc) => {
      this.currentHref = loc?.start?.href;
      this._onRelocated?.(loc);
    });

    return { title, totalLocations: 0 };
  }

  setSelectionHandler(fn) {
    this._onSelection = fn;
  }

  /** 由 reader 调用，返回通用的草稿结构 */
  captureSelection() {
    const s = this._lastSelection;
    if (!s) return null;
    const spineIndex = this.book.spine.get(s.cfiRange)?.index ?? 0;
    return {
      quote: s.text,
      anchor: { kind: "epub", cfi: s.cfiRange, quote: s.text, spineIndex },
    };
  }

  clearSelection() {
    try {
      this.rendition?.getContents().forEach((c) => c.window.getSelection()?.removeAllRanges());
    } catch {}
  }

  getOutline() {
    try {
      const nav = this.book.navigation;
      const walk = (items, depth = 0, out = []) => {
        for (const it of items || []) {
          out.push({ label: it.label?.trim() || "", href: it.href, depth });
          if (it.subitems?.length) walk(it.subitems, depth + 1, out);
        }
        return out;
      };
      return walk(nav.toc);
    } catch {
      return [];
    }
  }

  gotoHref(href) {
    this.rendition?.display(href);
  }

  setAnnotations(list) {
    this.annotations = list;
    this._renderHighlights();
  }

  _renderHighlights() {
    for (const [id, rec] of this._highlights) {
      try {
        this.rendition.annotations.remove(rec.cfiRange, "highlight");
      } catch {}
      this._highlights.delete(id);
    }
    for (const a of this.annotations) {
      if (a.anchor?.kind !== "epub" || !a.anchor.cfi) continue;
      try {
        this.rendition.annotations.highlight(
          a.anchor.cfi,
          { id: a.id },
          () => this._onHighlightClick?.(a.id),
          "epub-hl",
          { fill: a.color || "#ffe680", "fill-opacity": "0.35" }
        );
      } catch (e) {
        console.warn("epub highlight failed", a.id, e);
      }
    }
  }

  flashAnnotation(id) {
    const a = this.annotations.find((x) => x.id === id);
    if (a?.anchor?.cfi) this.rendition?.display(a.anchor.cfi);
  }

  getText() {
    try {
      const c = this.rendition?.getContents()?.[0];
      return c?.document?.body?.innerText || "";
    } catch {
      return "";
    }
  }

  zoomIn() {}
  zoomOut() {}
  fitToWidth() {}
}
