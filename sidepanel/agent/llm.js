// LLM 网络层。
//
// 两种发送方式，自动降级：
//   1. 页面直连（默认）：侧边栏/设置页自己有 host_permissions，可跨域请求；
//      本地中继会回 ACAO *，所以本地模型也走得通。不受 MV3 后台生命周期影响 —— 这是首选。
//   2. 后台 Service Worker 代理：直连被 CORS 拦掉（某些云端服务）时退回这条。
//      后台会因 30 秒空闲被回收，因此带 10 秒心跳；长回答仍有被回收的风险，只作兜底。
//
// 流式数据两边都是 SSE 原始文本，解析留在调用方。

const PORT_NAME = "llm";

/**
 * 流式请求 /chat/completions。
 * @param {{url:string, headers:object, body:string, onText:(t:string)=>void, signal?:AbortSignal}} p
 */
export async function streamChat({ url, headers, body, onText, signal }) {
  let received = false;
  const mark = (t) => {
    if (t) received = true;
    onText(t);
  };

  try {
    await directStream({ url, headers, body, onText: mark, signal });
    return;
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    // 已经吐出内容就不能重试，否则会重复
    if (received) throw e;
    console.warn("[llm] 页面直连失败，改走后台代理：", e?.message || e);
    try {
      await portStream({ url, headers, body, onText: mark, signal });
      return;
    } catch (e2) {
      if (e2?.name === "AbortError") throw e2;
      const both =
        `直连失败：${e?.message || e}\n` +
        `后台代理也失败：${e2?.message || e2}\n\n` +
        "两种方式都不通时，优先检查：① 中继（npm run relay）和 SSH 隧道是否还在跑；" +
        "② 设置里的 Base URL 与端口是否正确。";
      throw new Error(both);
    }
  }
}

/* ---------------- 方式一：页面直连 ---------------- */

async function directStream({ url, headers, body, onText, signal }) {
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal,
    credentials: "omit",
    cache: "no-store",
  });

  if (!resp.ok || !resp.body) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${detail.slice(0, 400)}`.trim());
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    onText(decoder.decode(value, { stream: true }));
  }
}

/* ---------------- 方式二：后台代理 ---------------- */

function portStream({ url, headers, body, onText, signal }) {
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

    // 后台可能被回收、模型也可能在冷启动，给 3 分钟
    watchdog = setTimeout(() => {
      finish(reject, new Error("响应超时：180 秒内没有收到任何数据（模型可能在加载，或服务未响应）"));
    }, 180_000);

    // 让后台保持存活（MV3 后台 30 秒无事件会被回收）
    heartbeat = setInterval(() => {
      try {
        port.postMessage({ type: "ping" });
      } catch {
        /* 端口已断，交给 onDisconnect */
      }
    }, 10_000);

    port.onMessage.addListener((m) => {
      if (m?.type === "chunk") onText(m.text || "");
      else if (m?.type === "done") finish(resolve);
      else if (m?.type === "aborted") finish(reject, Object.assign(new Error("已停止"), { name: "AbortError" }));
      else if (m?.type === "error") finish(reject, new Error(m.message || "请求失败"));
    });

    port.onDisconnect.addListener(() => {
      const le = chrome.runtime.lastError?.message;
      finish(
        reject,
        new Error(
          le
            ? `后台连接中断：${le}`
            : "后台连接中断（请求未完成）。可能是扩展后台被浏览器回收，或扩展刚被重载。"
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

/* ---------------- 探测（设置页「测试连接」） ---------------- */

/**
 * @param {{url:string, headers:object}} p
 * @returns {Promise<{ok:boolean, status?:number, body?:string, error?:string}>}
 */
export async function probe({ url, headers }) {
  // 先试页面直连（本地中继会回 ACAO *，云端服务有 host_permissions）
  try {
    const res = await fetch(url, { headers, credentials: "omit", cache: "no-store" });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: text.slice(0, 6000) };
  } catch (e) {
    console.warn("[llm] 探测直连失败，改走后台：", e?.message || e);
  }

  try {
    return (await chrome.runtime.sendMessage({ type: "llm:probe", url, headers })) || { ok: false, error: "无响应" };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
