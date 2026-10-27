// 诊断栏：任何脚本错误 / 未捕获异常都直接显示在面板顶部。
// 用普通 <script>（非 module）加载，这样即使 panel.js 加载失败也能捕获到。
(function () {
  const MAX = 6;

  function box() {
    let el = document.getElementById("diagBox");
    if (el) return el;
    el = document.createElement("div");
    el.id = "diagBox";
    el.className = "diag-box";
    el.hidden = true;
    document.body.prepend(el);
    return el;
  }

  function show(kind, msg) {
    try {
      const el = box();
      el.hidden = false;
      const line = document.createElement("div");
      line.className = "diag-line";
      line.textContent = `[${kind}] ${String(msg).slice(0, 600)}`;
      el.appendChild(line);
      while (el.children.length > MAX) el.removeChild(el.firstChild);
      console.error("[批注器]", kind, msg);
    } catch {
      /* 诊断本身失败就算了 */
    }
  }

  window.__diag = show;

  window.addEventListener("error", (e) => {
    if (e?.message) show("脚本错误", `${e.message} @ ${e.filename || "?"}:${e.lineno || 0}`);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const r = e?.reason;
    const text = r?.stack || r?.message || String(r);
    // 扩展被重新加载后，旧页面继续调用 chrome.* 会报这个
    if (/Extension context invalidated/i.test(text)) {
      show("页面已失效", "扩展重载后旧面板仍在运行，正在自动刷新…");
      // 旧页面的 URL 仍然有效，reload 会加载新版本；只尝试一次
      if (!sessionStorage.getItem("ctxReloaded")) {
        sessionStorage.setItem("ctxReloaded", "1");
        setTimeout(() => location.reload(), 600);
      } else {
        show("页面已失效", "自动刷新过但仍失效，请关闭侧边栏后重新打开。");
      }
      return;
    }
    show("未处理的 Promise", text);
  });
})();
