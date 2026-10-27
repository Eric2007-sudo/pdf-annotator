// 本地中继：让扩展能访问「不允许 chrome-extension:// 来源」的 Ollama。
//
// 背景：Ollama 默认只放行少量来源，扩展请求带 Origin: chrome-extension://<id>，
// 服务端直接返回 403。官方解法是设 OLLAMA_ORIGINS，但那需要改服务端环境
// （systemd 要 sudo）。很多机器改不了。
//
// 这个中继跑在你自己电脑上：收下扩展的请求，去掉 Origin / Referer，
// 再转给本机的 Ollama（通常是 SSH 隧道端口 11434）。Ollama 看到没有 Origin，
// 就按普通本地请求处理，不再 403。流式响应原样透传，不缓冲。
//
// 用法：
//   1) 先开 SSH 隧道：ssh -N -L 11434:127.0.0.1:11434 user@host
//   2) 再开中继：    npm run relay
//   3) 扩展里 Base URL 填 http://127.0.0.1:11500/v1
//
// 可用环境变量覆盖：
//   RELAY_PORT=11500      中继监听端口
//   RELAY_TARGET=http://127.0.0.1:11434   上游地址（指向隧道）

import http from "node:http";

const LISTEN_PORT = Number(process.env.RELAY_PORT || 11500);
const LISTEN_HOST = "127.0.0.1";
const TARGET = process.env.RELAY_TARGET || "http://127.0.0.1:11434";

let target;
try {
  target = new URL(TARGET);
} catch {
  console.error("RELAY_TARGET 不是合法 URL:", TARGET);
  process.exit(1);
}

// 这些头在转发时必须去掉或改写
const DROP_HEADERS = new Set(["origin", "referer", "host", "connection", "accept-encoding"]);

const server = http.createServer((req, res) => {
  // 预检：本地中继，直接放行
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "access-control-max-age": "86400",
    });
    res.end();
    return;
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (DROP_HEADERS.has(k.toLowerCase())) continue;
    headers[k] = v;
  }
  headers.host = target.host;

  const upstream = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      const out = { ...up.headers, "access-control-allow-origin": "*" };
      delete out["content-encoding"]; // 未压缩转发
      res.writeHead(up.statusCode || 502, out);
      // 流式：SSE 边收边发，不攒包
      up.pipe(res);
    }
  );

  upstream.setTimeout(0);
  upstream.on("error", (e) => {
    const msg = `中继无法连接上游 ${TARGET}：${e.message}\n（SSH 隧道开了吗？）`;
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(msg);
    console.error(msg);
  });

  req.pipe(upstream);
});

server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`端口 ${LISTEN_PORT} 已被占用。换个端口：set RELAY_PORT=11501 && npm run relay`);
  } else {
    console.error("中继启动失败:", e.message);
  }
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log("Ollama 中继已启动");
  console.log(`  监听: http://${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`  上游: ${TARGET}`);
  console.log("");
  console.log(`扩展里把 Base URL 填成: http://${LISTEN_HOST}:${LISTEN_PORT}/v1`);
  console.log("（改了端口的话用 RELAY_PORT 环境变量）");
});
