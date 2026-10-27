// 工具代理：把 panel 的工具请求转发到对应的阅读器 tab，再把结果送回 panel。
// 因为 panel 在侧边栏里时无法直接给 tab 发消息（它没有 tabs 权限里的消息路由能力），
// 统一走 SW 中转。

/**
 * @param {{type:string, payload?:object, tabId?:number}} req
 * @returns {Promise<any>}
 */
export async function proxyToReader({ type, payload, tabId }) {
  let id = tabId;
  if (!id) {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("reader/reader.html") + "*" });
    id = tabs[tabs.length - 1]?.id;
  }
  if (!id) return null;
  try {
    return await chrome.tabs.sendMessage(id, { type, payload });
  } catch {
    return null;
  }
}
