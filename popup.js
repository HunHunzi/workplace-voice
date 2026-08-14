import {
  DEFAULT_API_PROVIDER,
  getProviderPreset,
  mergeProviderConfigs,
} from "./organizer-core.js";

const enabledInput = document.getElementById("enabled");
const corporateJargonInput = document.getElementById("corporate-jargon-enabled");
const corporateJargonStatus = document.getElementById("corporate-jargon-status");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const workspaceButton = document.getElementById("workspace-button");
const settingsButton = document.getElementById("settings-button");

initialize().catch(() => {
  statusDot.classList.add("error");
  statusText.textContent = "读取设置失败";
});

async function initialize() {
  const settings = await chrome.storage.local.get({
    enabled: true,
    corporateJargonEnabled: false,
    apiProvider: DEFAULT_API_PROVIDER,
    providerConfigs: null,
  });
  enabledInput.checked = settings.enabled;
  corporateJargonInput.checked = settings.corporateJargonEnabled;
  updateJargonMode(settings.corporateJargonEnabled);
  updateStatusFromSettings(settings);
}

enabledInput.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({ enabled: enabledInput.checked });
    const settings = await chrome.storage.local.get({
      apiProvider: DEFAULT_API_PROVIDER,
      providerConfigs: null,
    });
    updateStatusFromSettings({ ...settings, enabled: enabledInput.checked });
  } catch {
    statusDot.className = "status-dot error";
    statusText.textContent = "保存开关状态失败";
  }
});

corporateJargonInput.addEventListener("change", async () => {
  const enabled = corporateJargonInput.checked;
  try {
    await chrome.storage.local.set({ corporateJargonEnabled: enabled });
    updateJargonMode(enabled);
  } catch {
    corporateJargonInput.checked = !enabled;
    updateJargonMode(!enabled);
    statusDot.className = "status-dot error";
    statusText.textContent = "保存黑话模式失败";
  }
});

settingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

workspaceButton.addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("workspace.html") });
    window.close();
  } catch {
    statusDot.className = "status-dot error";
    statusText.textContent = "无法打开整理台";
  }
});

function updateStatusFromSettings(settings) {
  const provider = getSafeProvider(settings.apiProvider);
  const config = mergeProviderConfigs(settings.providerConfigs)[provider];
  updateStatus(settings.enabled, Boolean(config.apiKey.trim()), getProviderPreset(provider).label);
}

function updateStatus(enabled, configured, providerLabel) {
  statusDot.className = "status-dot";
  if (!enabled) {
    statusDot.classList.add("error");
    statusText.textContent = "飞书快捷键已停用";
    return;
  }

  if (!configured) {
    statusText.textContent = "需要配置" + providerLabel + " API Key";
    return;
  }

  statusDot.classList.add("ready");
  statusText.textContent = providerLabel + "配置可用";
}

function updateJargonMode(enabled) {
  corporateJargonStatus.textContent = enabled ? "已开启，智能匹配职场术语" : "已关闭";
}

function getSafeProvider(provider) {
  try {
    getProviderPreset(provider);
    return provider;
  } catch {
    return DEFAULT_API_PROVIDER;
  }
}
