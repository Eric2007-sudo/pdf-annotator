// Markdown -> 安全 HTML（供 agent 气泡渲染）。
// vendor 里的 marked / dompurify 都是 UMD 包，以 <script> 方式在 panel 页面加载，
// 因此这里直接用 window 上的全局对象，不再 import（UMD 包无法作为 ESM 导入）。

export function renderMarkdown(src) {
  const cleaned = stripThink(src);
  try {
    const marked = window.marked;
    const DOMPurify = window.DOMPurify;
    if (!marked?.parse) return `<p>${escapeHtml(cleaned)}</p>`;
    const html = marked.parse(cleaned, { breaks: true });
    if (!DOMPurify?.sanitize) return escapeHtml(cleaned);
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } catch {
    return escapeHtml(cleaned);
  }
}

/**
 * 去掉推理模型的思考过程。
 * Qwen3 / DeepSeek-R1 会在正文里输出  thinking…<｜end▁of▁thinking｜>（有时用 <thinking>），
 * 直接渲染会让回答又长又吵。这里连未闭合的也算（流式过程中常见）。
 */
export function stripThink(text) {
  let s = String(text ?? "");
  s = s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  // 还没闭合的：从  thinking 截到结尾
  s = s.replace(/<think(?:ing)?>[\s\S]*$/i, "");
  return s.trimStart();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
