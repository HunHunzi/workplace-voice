import {
  API_PROVIDERS,
  DEFAULT_API_PROVIDER,
  MAX_INPUT_LENGTH,
  buildChatCompletionsUrl,
  buildRequestBody,
  createDefaultProviderConfigs,
  extractOutputText,
  formatApiError,
  getApiOriginPattern,
  getProviderPreset,
  mergeProviderConfigs,
} from "./organizer-core.js";

const DEFAULT_SETTINGS = {
  enabled: true,
  corporateJargonEnabled: false,
  apiProvider: DEFAULT_API_PROVIDER,
  providerConfigs: createDefaultProviderConfigs(),
  customInstructions: "",
};

const REQUEST_TIMEOUT_MS = 45_000;

chrome.runtime.onInstalled.addListener(({ reason }) => {
  initializeSettings(reason).catch((error) => {
    console.error("Failed to initialize extension settings", error);
  });
});

async function initializeSettings(reason) {
  const current = await chrome.storage.local.get({
    ...DEFAULT_SETTINGS,
    providerConfigs: null,
    dashscopeApiKey: "",
    model: "qwen-flash",
    apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: null,
  });
  const providerConfigs = mergeProviderConfigs(current.providerConfigs);

  if (!providerConfigs[API_PROVIDERS.ALIYUN].apiKey && current.dashscopeApiKey) {
    providerConfigs[API_PROVIDERS.ALIYUN] = {
      apiKey: current.dashscopeApiKey,
      model: current.model,
      apiBaseUrl: current.apiBaseUrl,
    };
  }

  await chrome.storage.local.set({
    enabled: current.enabled,
    corporateJargonEnabled: current.corporateJargonEnabled,
    apiProvider: getSafeProvider(current.apiProvider),
    providerConfigs,
    customInstructions: current.customInstructions,
  });

  await chrome.storage.local.remove(["apiKey", "dashscopeApiKey", "model", "apiBaseUrl"]);

  if (reason === "install") {
    await chrome.runtime.openOptionsPage();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ORGANIZE_TEXT") {
    return false;
  }

  organizeText(message.text)
    .then((text) => sendResponse({ ok: true, text }))
    .catch((error) => {
      const messageText = error instanceof Error ? error.message : "整理失败，请稍后重试";
      sendResponse({ ok: false, error: messageText });
    });

  return true;
});

async function organizeText(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("输入内容为空");
  }

  if (text.length > MAX_INPUT_LENGTH) {
    throw new Error(`内容过长，请控制在 ${MAX_INPUT_LENGTH} 个字符以内`);
  }

  const settings = await chrome.storage.local.get({
    ...DEFAULT_SETTINGS,
  });
  const provider = getSafeProvider(settings.apiProvider);
  const providerConfig = mergeProviderConfigs(settings.providerConfigs)[provider];
  const providerLabel = getProviderPreset(provider).label;

  const apiKey = providerConfig.apiKey.trim();
  if (!apiKey) {
    throw new Error(`请先在扩展设置中填写${providerLabel} API Key`);
  }

  const endpoint = buildChatCompletionsUrl(providerConfig.apiBaseUrl, provider);
  if (provider === API_PROVIDERS.CUSTOM) {
    const hasPermission = await chrome.permissions.contains({
      origins: [getApiOriginPattern(providerConfig.apiBaseUrl, provider)],
    });
    if (!hasPermission) {
      throw new Error("请在设置页保存自定义接口，并允许访问该 API 域名");
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(
        buildRequestBody({
          text,
          model: providerConfig.model,
          provider,
          customInstructions: settings.customInstructions,
          corporateJargonEnabled: settings.corporateJargonEnabled,
        }),
      ),
      signal: controller.signal,
    });

    const responseBody = await readJsonResponse(response, providerLabel);
    if (!response.ok) {
      throw new Error(formatApiError(response.status, responseBody, provider));
    }

    return extractOutputText(responseBody);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时，请检查网络后重试");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonResponse(response, providerLabel) {
  try {
    return await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`${providerLabel} API 请求失败（${response.status}）`);
    }
    throw new Error(`${providerLabel} API 返回了无法解析的数据`);
  }
}

function getSafeProvider(provider) {
  try {
    getProviderPreset(provider);
    return provider;
  } catch {
    return DEFAULT_API_PROVIDER;
  }
}
