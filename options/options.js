import {
  PROVIDERS,
  getProvider,
  getSettings,
  setSettings,
  clearApiKey,
  isInsecureUrl,
} from "../sidepanel/agent/settings.js";
import { probe } from "../sidepanel/agent/llm.js";

const $ = (id) => document.getElementById(id);

init();

async function init() {
  // provider 下拉
  $("provider").replaceChildren(
    ...PROVIDERS.map((p) => {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      return o;
    })
  );

  await loadProvider((await getSettings()).providerId);

  $("provider").addEventListener("change", () => {
    // 切换前先把当前填的内容存到当前 provider，避免丢失
    save({ silent: true }).then(() => loadProvider($("provider").value));
  });

  $("baseUrl").addEventListener("input", updateInsecureWarn);

  $("btnSave").addEventListener("click", async () => {
    await save();
    setStatus("已保存", "ok");
  });

  $("btnTest").addEventListener("click", testConnection);

  $("btnClearKey").addEventListener("click", async () => {
    if (!confirm("清除本机保存的这个服务的 API Key？")) return;
    await clearApiKey();
    $("apiKey").value = "";
    setStatus("已清除本机 key", "ok");
  });
}

/** 读取某个 provider 的配置并填进表单 */
async function loadProvider(providerId) {
  // 先切到目标 provider
  await setSettings({ providerId });
  const s = await getSettings();
  $("provider").value = s.providerId;
  $("baseUrl").value = s.baseUrl || "";
  $("model").value = s.model || "";
  $("apiKey").value = s.apiKey || "";
  $("toolsEnabled").checked = s.toolsEnabled !== false;
  $("extraBody").value = s.extraBody || "";

  const p = getProvider(s.providerId);
  $("providerHelp").textContent = p.help || "";
  $("apiKey").placeholder = p.needsKey ? "sk-..." : "（本机服务无需填写）";
  $("keyHint").innerHTML = p.needsKey
    ? "仅保存在本机 <code>chrome.storage.local</code>，明文、不同步、不上传。只有上面这个 Base URL 会收到它。"
    : "这个服务不需要 key，留空即可。<b>若留空，请求不会带 Authorization 头。</b>";
  renderModelHints(p);

  updateInsecureWarn();
  setStatus("");
}

/** 模型候选随 provider 变化 */
function renderModelHints(provider) {
  const list = $("modelList");
  list.replaceChildren(
    ...(provider.models || []).map((m) => {
      const o = document.createElement("option");
      o.value = m;
      return o;
    })
  );
  $("model").placeholder = provider.model || "模型名";
}

async function save({ silent = false } = {}) {
  await setSettings({
    baseUrl: $("baseUrl").value.trim(),
    model: $("model").value.trim(),
    apiKey: $("apiKey").value.trim(),
    toolsEnabled: $("toolsEnabled").checked,
    extraBody: $("extraBody").value.trim(),
  });
  if (!silent) setStatus("已保存", "ok");
}

function updateInsecureWarn() {
  const url = $("baseUrl").value.trim();
  const key = $("apiKey").value.trim();
  $("insecureWarn").hidden = !(key && isInsecureUrl(url));
}

async function testConnection() {
  setStatus("测试中…");
  const base = ($("baseUrl").value.trim() || "").replace(/\/+$/, "");
  const key = $("apiKey").value.trim();
  const want = $("model").value.trim();

  if (!base) {
    setStatus("请先填 Base URL", "err");
    return;
  }

  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;

  // 走后台发请求：扩展后台有 host_permissions，不受目标站点 CORS 限制
  const r = await probe({ url: `${base}/models`, headers });

  if (!r.ok) {
    const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(base);
    setStatus(
      "失败：" + (r.error || `HTTP ${r.status} ${(r.body || "").slice(0, 200)}`) +
        (isLocal ? "　—— 本地服务常见原因：没启动、或 SSH 隧道没开。" : ""),
      "err"
    );
    return;
  }

  let ids = [];
  try {
    ids = (JSON.parse(r.body || "{}").data || []).map((m) => m.id).filter(Boolean);
  } catch {
    /* 有些服务的 /models 不是标准结构，忽略 */
  }

  if (ids.length && want && !ids.includes(want)) {
    setStatus(`连接正常 ✓，但模型列表里没有「${want}」。可用：${ids.slice(0, 6).join(", ")}`, "ok");
  } else {
    setStatus(`连接正常 ✓${ids.length ? `（${ids.length} 个模型）` : ""}`, "ok");
  }
}

function setStatus(text, cls = "") {
  const el = $("status");
  el.textContent = text;
  el.className = "hint " + cls;
}
