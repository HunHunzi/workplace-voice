import {
  DEFAULT_API_PROVIDER,
  MAX_INPUT_LENGTH,
  getProviderPreset,
  mergeProviderConfigs,
} from "./organizer-core.js";

const sourceInput = document.getElementById("source-input");
const resultOutput = document.getElementById("result-output");
const inputCount = document.getElementById("input-count");
const status = document.getElementById("status");
const modelLabel = document.getElementById("model-label");
const organizeButton = document.getElementById("organize-button");
const clearButton = document.getElementById("clear-button");
const copyButton = document.getElementById("copy-button");
const settingsButton = document.getElementById("settings-button");
let isLoading = false;

sourceInput.maxLength = MAX_INPUT_LENGTH;
updateCharacterCount();
loadConfigSummary().catch(() => {
  modelLabel.textContent = "配置读取失败";
});

sourceInput.addEventListener("input", updateCharacterCount);
sourceInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.metaKey && !event.isComposing) {
    event.preventDefault();
    organizeContent();
  }
});

organizeButton.addEventListener("click", organizeContent);
clearButton.addEventListener("click", clearWorkspace);
copyButton.addEventListener("click", copyResult);
settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes.apiProvider || changes.providerConfigs || changes.corporateJargonEnabled)
  ) {
    loadConfigSummary().catch(() => {
      modelLabel.textContent = "配置读取失败";
    });
  }
});

async function loadConfigSummary() {
  const settings = await chrome.storage.local.get({
    apiProvider: DEFAULT_API_PROVIDER,
    providerConfigs: null,
    corporateJargonEnabled: false,
  });
  const provider = getSafeProvider(settings.apiProvider);
  const providerLabel = getProviderPreset(provider).label;
  const providerConfig = mergeProviderConfigs(settings.providerConfigs)[provider];
  const modeLabel = settings.corporateJargonEnabled ? " · 大厂黑话版" : "";
  modelLabel.textContent = `${providerLabel} · ${providerConfig.model || "未设置模型"}${modeLabel}`;

  if (!providerConfig.apiKey.trim()) {
    showStatus(`请先在设置中填写${providerLabel} API Key`, "error");
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

async function organizeContent() {
  if (isLoading) {
    return;
  }

  const text = sourceInput.value.trim();
  if (!text) {
    showStatus("请输入需要整理的内容", "error");
    sourceInput.focus();
    return;
  }

  setLoading(true);
  showStatus("正在整理...", "");

  try {
    const response = await sendRuntimeMessage({ type: "ORGANIZE_TEXT", text });
    if (!response?.ok) {
      throw new Error(response?.error || "整理失败，请稍后重试");
    }

    resultOutput.value = response.text;
    resultOutput.scrollTop = 0;
    copyButton.disabled = false;
    showStatus("整理完成", "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "整理失败，请稍后重试";
    showStatus(message, "error");
  } finally {
    setLoading(false);
  }
}

function clearWorkspace() {
  sourceInput.value = "";
  resultOutput.value = "";
  copyButton.disabled = true;
  updateCharacterCount();
  showStatus("已清空", "");
  sourceInput.focus();
}

async function copyResult() {
  if (!resultOutput.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(resultOutput.value);
  } catch {
    resultOutput.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    resultOutput.setSelectionRange(0, 0);
    if (!copied) {
      showStatus("复制失败，请手动选择结果", "error");
      return;
    }
  }

  showStatus("结果已复制", "success");
}

function updateCharacterCount() {
  inputCount.textContent = `${sourceInput.value.length} / ${MAX_INPUT_LENGTH}`;
}

function setLoading(loading) {
  isLoading = loading;
  organizeButton.disabled = loading;
  clearButton.disabled = loading;
  sourceInput.readOnly = loading;
  sourceInput.setAttribute("aria-busy", String(loading));
  organizeButton.textContent = loading ? "整理中..." : "整理内容";
}

function showStatus(message, type) {
  status.textContent = message;
  status.className = type ? `status ${type}` : "status";
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
