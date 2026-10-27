// LLM 网络层：所有模型请求统一交给后台 Service Worker 发送。
//
// 为什么不让面板自己 fetch：
//   1. 扩展页面发跨域请求会受 CORS 约束，Ollama 默认不放行 chrome-extension:// 来源，
//      用户就得改服务端配置（很多场景没有 sudo 权限，改不了）；
//   2. 扩展的 Service Worker 在 manifest 里有 host_permissions 时，可以直接跨域请求，
//      不受目标站点 CORS 限制，也不需要服务端配合；
//   3. key 只在后台与 storage 之间流转，面板只拿到模型输出。
//
// 流式：用长连接 Port 传 SSE 原始文本，后台不做解析，解析留在调用方（agent.js）。

const PORT_NAME = "llm";

/**
 * 流式请求 /chat/completions。
 * @param {{url:string, headers:object, body:string, onText:(t:string)=>void, signal?:AbortSignal}} p
 */
export function streamChat({ url, headers, body, onText, signal }) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch (e) {
      reject(new Error("无法连接后台服务：" + (e?.message || e)));
      return;
    }

    let settled = false;
    let watchdog = 0;
    let heartbeat = 0;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      clearInterval(heartbeat);
      try {
        port.disconnect();
      } catch {}
      signal?.removeEventListener("abort", onAbort);
      fn(arg);
    };

    const onAbort = () => finish(reject, Object.assign(new Error("已停止"), { name: "AbortError" }));

    // 首字节可能在模型加载时等很久，给 3 分钟；超过就报错，避免界面永久卡住
    watchdog = setTimeout(() => {
      finish(reject, new Error("响应超时：180 秒内没有收到任何数据（模型可能在加载，或服务未响应）"));
    }, 180_000);

    // MV3 后台 30 秒无事件会被回收。模型冷启动期间没有任何数据流动，
    // 所以每 10 秒发一次心跳，让后端保持存活。
    heartbeat = setInterval(() => {
      try {
        port.postMessage({ type: "ping" });
      } catch {
        /* 端口已断，交给 onDisconnect 处理 */
      }
    }, 10_000);

    port.onMessage.addListener((m) => {
      if (m?.type === "chunk") {
        onText(m.text || "");
      } else if (m?.type === "done") {
        finish(resolve);
      } else if (m?.type === "aborted") {
        finish(reject, Object.assign(new Error("已停止"), { name: "AbortError" }));
      } else if (m?.type === "error") {
        finish(reject, new Error(m.message || "请求失败"));
      }
      // pong 不需要处理，收到本身就说明后台还活着
    });

    port.onDisconnect.addListener(() => {
      const le = chrome.runtime.lastError?.message;
      finish(
        reject,
        new Error(
          le
            ? `后台连接中断：${le}`
            : "后台连接中断（请求未完成）。常见原因：扩展后台被浏览器回收、扩展刚被重载、或服务端长时间没有响应。"
        )
      );
    });

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    port.postMessage({ type: "start", url, headers, body });
  });
}

/**
 * 非流式探测（用于「测试连接」）：拿 /models 的结果。
 * @param {{url:string, headers:object}} p
 * @returns {Promise<{ok:boolean, status?:number, body?:string, error?:string}>}
 */
export async function probe({ url, headers }) {
  try {
    return (await chrome.runtime.sendMessage({ type: "llm:probe", url, headers })) || { ok: false, error: "无响应" };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
