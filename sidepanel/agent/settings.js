// 设置读写。
//
// 目标：
//   1. 可扩展——任何 OpenAI 兼容服务（DeepSeek / OpenAI / Ollama / 自建网关）都能接；
//   2. 每个 provider 各存一份配置，切换时不会丢 key 和地址；
//   3. key 只存在本机 chrome.storage.local，明文（UI 里明示），绝不写进代码、绝不进导出。
//
// 存储结构：
//   providerId : 当前使用的 provider id
//   configs    : { [providerId]: {baseUrl, model, apiKey, toolsEnabled} }
//
// 旧版本是扁平的 {apiKey, baseUrl, model}，getSettings() 会自动迁移到 configs.deepseek。

export const PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek API",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-pro", "deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
    vendor: "DeepSeek",
    help: "key 在 platform.deepseek.com 申请，按用量计费。",
  },
  {
    id: "kimi",
    name: "Kimi（月之暗面）",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-latest",
    models: ["kimi-latest", "kimi-k2-turbo-preview", "moonshot-v1-8k", "moonshot-v1-32k"],
    needsKey: true,
    vendor: "Moonshot AI",
    help: "key 在 platform.moonshot.cn 申请。长文阅读推荐 moonshot-v1-32k 及以上。",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    models: ["glm-4-flash", "glm-4-plus", "glm-4.5", "glm-4v-flash"],
    needsKey: true,
    vendor: "智谱 AI",
    help: "key 在 open.bigmodel.cn 申请。glm-4-flash 有免费额度。",
  },
  {
    id: "qwen",
    name: "通义千问（阿里百炼）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    models: ["qwen-plus", "qwen-turbo", "qwen-max", "qwen-long"],
    needsKey: true,
    vendor: "阿里云",
    help: "key 在 bailian.console.aliyun.com 申请。qwen-long 适合一次读很长文档。",
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-7B-Instruct",
    models: [
      "Qwen/Qwen2.5-7B-Instruct",
      "deepseek-ai/DeepSeek-V3",
      "moonshotai/Kimi-K2-Instruct",
      "THUDM/glm-4-9b-chat",
    ],
    needsKey: true,
    vendor: "硅基流动",
    help: "国内聚合平台，一个 key 能用多家开源模型。",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    models: ["google/gemini-2.0-flash-001", "anthropic/claude-3.5-sonnet", "openai/gpt-4o-mini"],
    needsKey: true,
    vendor: "OpenRouter",
    help: "聚合平台，模型名要写全（如 anthropic/claude-3.5-sonnet）。",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "o4-mini"],
    needsKey: true,
    vendor: "OpenAI",
    help: "需要能直连的网络环境，或把 Base URL 改成你的中转地址。",
  },
  {
    id: "ollama",
    name: "Ollama（仅本机 / 自用隧道）",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3:4b",
    models: ["qwen3:4b", "qwen3:1.7b", "deepseek-r1:7b", "qwen2.5-coder:7b"],
    needsKey: false,
    vendor: "Ollama",
    help: "跑在你自己机器上的模型，别人无法共用。远程机器请先建 SSH 隧道（见设置页底部）。若报 403，改用下面的「经本地中继」。",
  },
  {
    id: "ollama-relay",
    name: "Ollama（经本地中继，绕开 403）",
    baseUrl: "http://127.0.0.1:11500/v1",
    model: "qwen3:4b",
    models: ["qwen3:4b", "qwen3:1.7b", "deepseek-r1:7b", "qwen2.5-coder:7b"],
    needsKey: false,
    vendor: "Ollama",
    help: "先在项目目录跑 npm run relay（保持窗口开着）。它把请求的 Origin 头去掉再转给隧道，Ollama 就不会 403。不需要改服务端。",
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    baseUrl: "",
    model: "",
    models: [],
    needsKey: true,
    vendor: "第三方服务",
    help: "任何兼容 /chat/completions 的服务：vLLM、LM Studio、One API、自建网关。",
  },
];

const DEFAULT_PROVIDER = "deepseek";

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

/** 某个 provider 的默认配置 */
function defaultConfig(provider) {
  return {
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: "",
    toolsEnabled: true,
    extraBody: "",
  };
}

/**
 * @returns {Promise<{providerId:string, provider:object, baseUrl:string, model:string, apiKey:string, toolsEnabled:boolean}>}
 */
export async function getSettings() {
  const raw = await chrome.storage.local.get([
    "providerId",
    "configs",
    // 旧版扁平字段
    "apiKey",
    "baseUrl",
    "model",
    "toolsEnabled",
  ]);

  let configs = raw.configs && typeof raw.configs === "object" ? { ...raw.configs } : null;

  // 迁移旧版扁平配置
  if (!configs) {
    configs = {};
    const legacy = {
      baseUrl: raw.baseUrl || "",
      model: raw.model || "",
      apiKey: raw.apiKey || "",
      toolsEnabled: raw.toolsEnabled !== false,
    };
    if (legacy.apiKey || legacy.baseUrl || legacy.model) {
      // 旧版的 Base URL 指向 deepseek 以外的服务时归到 custom
      const isDeepSeek = /deepseek\.com/i.test(legacy.baseUrl) || !legacy.baseUrl;
      const pid = isDeepSeek ? "deepseek" : "custom";
      configs[pid] = { ...defaultConfig(getProvider(pid)), ...legacy };
      await chrome.storage.local.set({ providerId: pid, configs });
      await chrome.storage.local.remove(["apiKey", "baseUrl", "model", "toolsEnabled"]);
    } else {
      configs = { [DEFAULT_PROVIDER]: defaultConfig(getProvider(DEFAULT_PROVIDER)) };
    }
  }

  const providerId = raw.providerId || DEFAULT_PROVIDER;
  const provider = getProvider(providerId);
  const cfg = { ...defaultConfig(provider), ...(configs[providerId] || {}) };

  return {
    providerId,
    provider,
    baseUrl: cfg.baseUrl || provider.baseUrl,
    model: cfg.model || provider.model,
    apiKey: cfg.apiKey || "",
    toolsEnabled: cfg.toolsEnabled !== false,
    extraBody: cfg.extraBody || "",
  };
}

/**
 * 只写当前 provider 的配置。切换 provider 用 {providerId}。
 * @param {{providerId?:string, baseUrl?:string, model?:string, apiKey?:string, toolsEnabled?:boolean}} patch
 */
export async function setSettings(patch = {}) {
  const raw = await chrome.storage.local.get(["providerId", "configs"]);
  const providerId = patch.providerId || raw.providerId || DEFAULT_PROVIDER;
  const provider = getProvider(providerId);

  const configs = { ...(raw.configs || {}) };
  const current = { ...defaultConfig(provider), ...(configs[providerId] || {}) };

  for (const k of ["baseUrl", "model", "apiKey", "toolsEnabled", "extraBody"]) {
    if (patch[k] !== undefined) current[k] = patch[k];
  }
  configs[providerId] = current;

  await chrome.storage.local.set({ providerId, configs });
  return getSettings();
}

/** 只清掉当前 provider 的 key */
export async function clearApiKey() {
  return setSettings({ apiKey: "" });
}

/** 判断地址是否会把 key 明文发到网络上（http 且非本机回环） */
export function isInsecureUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return false;
    return !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  } catch {
    return false;
  }
}
