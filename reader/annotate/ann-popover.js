// 批注气泡：编辑笔记、改色、删除、发给 AI。
const PALETTE = [
  ["yellow", "#ffe680"],
  ["green", "#b7f0a8"],
  ["blue", "#a8d8f0"],
  ["pink", "#f7b6d2"],
  ["purple", "#d8c4f0"],
];

export class AnnPopover {
  constructor(host = document.body) {
    this.host = host;
    this.el = null;
    this.current = null;
    this.onSave = () => {};
    this.onDelete = () => {};
    this.onAsk = () => {};
  }

  open({ x, y, id, anchor, quote, color = "yellow", note = "", mode = "create" }) {
    this.close();
    this.current = { id, anchor, quote, color, note, mode };

    const el = document.createElement("div");
    el.className = "ann-pop";
    el.innerHTML = `
      <div class="quote"></div>
      <textarea placeholder="写点笔记…（Ctrl+Enter 保存）"></textarea>
      <div class="row">
        <div class="colors"></div>
        <div style="flex:1"></div>
        <button class="btn ask" title="把这段发给 AI">问 AI</button>
        <button class="btn danger del">删除</button>
        <button class="btn primary save">保存</button>
      </div>
    `;
    el.querySelector(".quote").textContent = quote || "（无选中文字）";
    const ta = el.querySelector("textarea");
    ta.value = note || "";

    const colors = el.querySelector(".colors");
    for (const [name, hex] of PALETTE) {
      const sw = document.createElement("button");
      sw.className = "swatch";
      sw.style.background = hex;
      sw.dataset.color = name;
      sw.setAttribute("aria-pressed", String(name === color));
      sw.addEventListener("click", () => {
        this.current.color = name;
        for (const s of colors.children) s.setAttribute("aria-pressed", String(s.dataset.color === name));
      });
      colors.appendChild(sw);
    }

    if (mode === "create") el.querySelector(".del").classList.add("hidden");
    // 新建时没有原文就不该保存
    if (mode === "create" && !String(quote || "").trim()) el.querySelector(".save").disabled = true;

    const save = () => {
      this.onSave({ ...this.current, note: ta.value });
      this.close();
    };
    el.querySelector(".save").addEventListener("click", save);
    el.querySelector(".del").addEventListener("click", () => {
      if (this.current.id) this.onDelete(this.current.id);
      this.close();
    });
    el.querySelector(".ask").addEventListener("click", () => {
      this.onAsk({ ...this.current, note: ta.value });
    });
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
      if (e.key === "Escape") this.close();
    });

    this.host.appendChild(el);
    this.el = el;
    this._position(x, y);
    setTimeout(() => ta.focus(), 30);
    document.addEventListener("mousedown", this._outside, true);
    document.addEventListener("keydown", this._esc, true);
  }

  _position(x, y) {
    const el = this.el;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let left = x - rect.width / 2;
    let top = y + 12;
    if (left < pad) left = pad;
    if (left + rect.width > innerWidth - pad) left = innerWidth - pad - rect.width;
    if (top + rect.height > innerHeight - pad) top = Math.max(pad, y - rect.height - 12);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  _outside = (e) => {
    if (this.el && !this.el.contains(e.target)) this.close();
  };
  _esc = (e) => {
    if (e.key === "Escape") this.close();
  };

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    document.removeEventListener("mousedown", this._outside, true);
    document.removeEventListener("keydown", this._esc, true);
  }
}
