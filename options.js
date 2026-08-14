import {
  API_PROVIDERS,
  DEFAULT_API_PROVIDER,
  createDefaultProviderConfigs,
  getApiOriginPattern,
  getProviderPreset,
  mergeProviderConfigs,
  normalizeApiBaseUrl,
} from "./organizer-core.js";

const DEFAULTS = {
  enabled: true,
  corporateJargonEnabled: false,
  apiProvider: DEFAULT_API_PROVIDER,
  providerConfigs: createDefaultProviderConfigs(),
  customInstructions: "",
};

const form = document.getElementById("settings-form");
const enabledInput = document.getElementById("enabled");
const corporateJargonInput = document.getElementById("corporate-jargon-enabled");
const providerSelect = document.getElementById("api-provider");
const apiKeyInput = document.getElementById("api-key");
const apiKeyLabel = document.getElementById("api-key-label");
const modelInput = document.getElementById("model");
const apiBaseUrlInput = document.getElementById("api-base-url");
const apiBaseUrlHelp = document.getElementById("api-base-url-help");
const customInstructionsInput = document.getElementById("custom-instructions");
const connectionBadge = document.getElementById("connection-badge");
const status = document.getElementById("status");
const testButton = document.getElementById("test-button");
const testResult = document.getElementById("test-result");
const testOutput = document.getElementById("test-output");

let activeProvider = DEFAULT_API_PROVIDER;
let providerConfigs = createDefaultProviderConfigs();

initialize().catch(() => {
  showStatus("读取设置失败，请重新加载扩展", true);
});

async function initialize() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  enabledInput.checked = settings.enabled;
  corporateJargonInput.checked = settings.corporateJargonEnabled;
  providerConfigs = mergeProviderConfigs(settings.providerConfigs);
  activeProvider = getSafeProvider(settings.apiProvider);
  providerSelect.value = activeProvider;
  customInstructionsInput.value = settings.customInstructions;
  renderActiveProvider();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveSettings();
    showStatus("设置已保存");
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存设置失败";
    showStatus(message, true);
  }
});

providerSelect.addEventListener("change", () => {
  captureActiveProviderConfig();
  activeProvider = getSafeProvider(providerSelect.value);
  renderActiveProvider();
  testResult.hidden = true;
  showStatus("");
});

apiKeyInput.addEventListener("input", updateConnectionBadge);

testButton.addEventListener("click", async () => {
  setTesting(true);
  showStatus("正在调用 API 测试...");
  testResult.hidden = true;

  try {
    await saveSettings();
    const response = await sendRuntimeMessage({
      type: "ORGANIZE_TEXT",
      text: "下周一上线新版本，张三检查数据，李四今天把文案发我，还有测试环境周五前要确认一下，另外上线时间是下周一上午十点。",
    });

    if (!response?.ok) {
      throw new Error(response?.error || "测试失败");
    }

    testOutput.textContent = response.text;
    testResult.hidden = false;
    showStatus(getProviderPreset(activeProvider).label + "测试成功");
  } catch (error) {
    const message = error instanceof Error ? error.message : "测试失败";
    showStatus(message, true);
  } finally {
    setTesting(false);
  }
});

async function saveSettings() {
  captureActiveProviderConfig();
  const config = providerConfigs[activeProvider];
  if (!config.model.trim()) {
    throw new Error("模型名称不能为空");
  }

  config.apiBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl, activeProvider);
  apiBaseUrlInput.value = config.apiBaseUrl;

  if (activeProvider === API_PROVIDERS.CUSTOM) {
    await requestCustomHostPermission(config.apiBaseUrl);
  }

  await chrome.storage.local.set({
    enabled: enabledInput.checked,
    corporateJargonEnabled: corporateJargonInput.checked,
    apiProvider: activeProvider,
    providerConfigs,
    customInstructions: customInstructionsInput.value.trim(),
  });
  updateConnectionBadge();
}

function captureActiveProviderConfig() {
  providerConfigs[activeProvider] = {
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
    apiBaseUrl: apiBaseUrlInput.value.trim(),
  };
}

function renderActiveProvider() {
  const preset = getProviderPreset(activeProvider);
  const config = providerConfigs[activeProvider];
  apiKeyLabel.textContent = preset.label + " API Key";
  apiKeyInput.value = config.apiKey;
  modelInput.value = config.model;
  apiBaseUrlInput.value = config.apiBaseUrl;
  apiBaseUrlHelp.textContent = getBaseUrlHelp(activeProvider);
  updateConnectionBadge();
}

async function requestCustomHostPermission(apiBaseUrl) {
  const origins = [getApiOriginPattern(apiBaseUrl, API_PROVIDERS.CUSTOM)];
  const granted = await chrome.permissions.request({ origins });
  if (!granted) {
    throw new Error("需要允许访问该 API 域名，才能使用自定义接口");
  }
}

function getBaseUrlHelp(provider) {
  if (provider === API_PROVIDERS.ALIYUN) {
    return "默认使用北京公共地址；使用业务空间专属地址时可替换。";
  }
  if (provider === API_PROVIDERS.OPENAI) {
    return "使用 OpenAI 官方 Chat Completions 地址。";
  }
  return "填写支持 OpenAI Chat Completions 协议的 HTTPS Base URL。";
}

function getSafeProvider(provider) {
  try {
    getProviderPreset(provider);
    return provider;
  } catch {
    return DEFAULT_API_PROVIDER;
  }
}

function updateConnectionBadge() {
  const configured = Boolean(apiKeyInput.value.trim());
  connectionBadge.textContent = configured ? "已配置" : "未配置";
  connectionBadge.classList.toggle("configured", configured);
}

function setTesting(testing) {
  testButton.disabled = testing;
  testButton.textContent = testing ? "测试中..." : "测试配置";
}

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("扩展后台连接失败，请重新加载扩展"));
        return;
      }
      resolve(response);
    });
  });
}
