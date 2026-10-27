// 消息协议：所有跨上下文(structured)通信的 type 与校验集中在这里。
// 约定：channel 前缀 = 发送方 -> 接收方

export const MSG = {
  // SW <- any
  READER_OPEN: "reader:open",
  PANEL_OPEN: "panel:open",
  PING: "ping",

  // reader <-> panel
  READER_READY: "reader:ready", // reader -> panel: 新文档已就绪
  READER_CONTEXT: "reader:context", // panel -> reader: 请求上下文
  READER_CONTEXT_RESULT: "reader:context:result",
  READER_GOTO: "reader:goto", // panel -> reader: 跳转批注
  READER_SELECTION: "reader:selection", // reader -> panel: 用户划过文字

  // reader -> panel: 预填 prompt
  LLM_PREFILL: "llm:prefill",

  // panel -> reader: agent 工具请求
  TOOL_SELECTION: "reader:tool:selection",
  TOOL_SEARCH: "reader:tool:search",
  TOOL_RESULT: "reader:tool:result",
};

/** 当前处于活动中的阅读器 tab 的窗口/标签信息缓存（panel 用） */
export function isValidMessage(m) {
  return m && typeof m === "object" && typeof m.type === "string" && MSG[Object.keys(MSG).find((k) => MSG[k] === m.type)] !== undefined;
}

/**
 * 向所有扩展页面广播（panel 与 reader 都可能监听）。
 * 用 chrome.runtime.sendMessage 会找不到自己，因此这里用多种方式兜底。
 */
export async function broadcast(msg) {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    /* 无接收者 */
  }
}
