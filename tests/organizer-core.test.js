import test from "node:test";
import assert from "node:assert/strict";

import {
  API_PROVIDERS,
  CORPORATE_JARGON_INSTRUCTIONS,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_PROVIDER,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_MODEL,
  buildChatCompletionsUrl,
  buildRequestBody,
  createDefaultProviderConfigs,
  extractOutputText,
  formatApiError,
  getApiOriginPattern,
  mergeProviderConfigs,
  normalizeApiBaseUrl,
} from "../organizer-core.js";

test("buildRequestBody creates a non-streaming Qwen request", () => {
  const body = buildRequestBody({
    text: "  第一件事 第二件事  ",
    model: "",
    customInstructions: "语气亲切",
  });

  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /语气亲切/);
  assert.deepEqual(body.messages[1], { role: "user", content: "第一件事 第二件事" });
  assert.equal(body.stream, false);
  assert.equal(body.enable_thinking, false);
  assert.equal(DEFAULT_API_PROVIDER, API_PROVIDERS.ALIYUN);
});

test("buildRequestBody omits Aliyun-only parameters for OpenAI", () => {
  const body = buildRequestBody({
    text: "整理这段话",
    model: "gpt-5.6-luna",
    provider: API_PROVIDERS.OPENAI,
  });

  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal("enable_thinking" in body, false);
});

test("default instructions enforce the agreed workplace style", () => {
  assert.match(DEFAULT_INSTRUCTIONS, /结论先行/);
  assert.match(DEFAULT_INSTRUCTIONS, /使用最少够用的结构/);
  assert.match(DEFAULT_INSTRUCTIONS, /编号只用于有先后顺序/);
  assert.match(DEFAULT_INSTRUCTIONS, /一点一事/);
  assert.match(DEFAULT_INSTRUCTIONS, /自然简洁/);
  assert.match(DEFAULT_INSTRUCTIONS, /不把推测改成确定结论/);
  assert.match(DEFAULT_INSTRUCTIONS, /不要自动添加“结论：”“需确认：”/);
  assert.match(DEFAULT_INSTRUCTIONS, /不长于原文/);
  assert.match(DEFAULT_INSTRUCTIONS, /API 和之前的差别好像挺大/);
  assert.match(DEFAULT_INSTRUCTIONS, /长内容包含三个以上独立事项时/);
  assert.match(DEFAULT_INSTRUCTIONS, /@Joel Joel老师/);
  assert.match(DEFAULT_INSTRUCTIONS, /@黄子轩 子轩老师/);
  assert.match(DEFAULT_INSTRUCTIONS, /负责人待确认/);
  assert.match(DEFAULT_INSTRUCTIONS, /每个链接单独占一行/);
  assert.match(DEFAULT_INSTRUCTIONS, /测试原定周四下午/);
  assert.match(DEFAULT_INSTRUCTIONS, /字号、间距和变量色由前端实现/);
  assert.doesNotMatch(DEFAULT_INSTRUCTIONS, /存在两个及以上独立事项时，必须使用/);
});

test("corporate jargon mode adds contextual vocabulary rules", () => {
  const regularBody = buildRequestBody({
    text: "多个团队一起推动项目完成",
    model: DEFAULT_MODEL,
  });
  const jargonBody = buildRequestBody({
    text: "多个团队一起推动项目完成",
    model: DEFAULT_MODEL,
    corporateJargonEnabled: true,
  });

  assert.doesNotMatch(regularBody.messages[0].content, /大厂黑话版/);
  assert.match(jargonBody.messages[0].content, /大厂黑话版/);
  assert.match(jargonBody.messages[0].content, /中英混搭/);
  assert.match(jargonBody.messages[0].content, /完成、做完、结束.*done/);
  assert.match(jargonBody.messages[0].content, /批准、同意申请、审批通过.*approve/);
  assert.match(jargonBody.messages[0].content, /owner.*deadline.*TBD/);
  assert.match(jargonBody.messages[0].content, /QA sync/);
  assert.match(jargonBody.messages[0].content, /blocker.*done 后给到我/);
  assert.match(jargonBody.messages[0].content, /完整 JSON.*不得替换/);
  assert.match(jargonBody.messages[0].content, /审核内容、代码评审、检查.*不得一律替换/);
  assert.match(CORPORATE_JARGON_INSTRUCTIONS, /不是把原话扩写成流程、清单或汇报材料/);
  assert.match(CORPORATE_JARGON_INSTRUCTIONS, /不要擅自改成“需确认：”“待办：”/);
  assert.match(CORPORATE_JARGON_INSTRUCTIONS, /梳理清单、与相关方核实/);
  assert.match(CORPORATE_JARGON_INSTRUCTIONS, /你需要对齐颗粒度，有足够的 input 给到我/);
  assert.match(CORPORATE_JARGON_INSTRUCTIONS, /不随时态改写为 approved、finished/);
});

test("buildRequestBody rejects empty drafts", () => {
  assert.throws(
    () => buildRequestBody({ text: "  ", model: DEFAULT_MODEL }),
    /请输入需要整理的内容/,
  );
});

test("normalizeApiBaseUrl allows supported Bailian endpoints", () => {
  assert.equal(normalizeApiBaseUrl(""), DEFAULT_API_BASE_URL);
  assert.equal(
    buildChatCompletionsUrl("https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/"),
    "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
  );
  assert.equal(
    normalizeApiBaseUrl(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    ),
    DEFAULT_API_BASE_URL,
  );
});

test("normalizeApiBaseUrl rejects non-Bailian hosts", () => {
  assert.throws(
    () => normalizeApiBaseUrl("https://example.com/compatible-mode/v1"),
    /阿里云百炼的 HTTPS 域名/,
  );
});

test("provider URLs are normalized independently", () => {
  assert.equal(
    buildChatCompletionsUrl("", API_PROVIDERS.OPENAI),
    "https://api.openai.com/v1/chat/completions",
  );
  assert.equal(
    buildChatCompletionsUrl("https://api.example.com/v1/", API_PROVIDERS.CUSTOM),
    "https://api.example.com/v1/chat/completions",
  );
  assert.equal(
    getApiOriginPattern("https://api.example.com/v1", API_PROVIDERS.CUSTOM),
    "https://api.example.com/*",
  );
  assert.throws(
    () => normalizeApiBaseUrl("http://api.example.com/v1", API_PROVIDERS.CUSTOM),
    /HTTPS URL/,
  );
});

test("provider configurations keep credentials separate", () => {
  const configs = createDefaultProviderConfigs();
  configs.aliyun.apiKey = "aliyun-test-key";
  const merged = mergeProviderConfigs(configs);

  assert.equal(merged.aliyun.apiKey, "aliyun-test-key");
  assert.equal(merged.openai.apiKey, "");
  assert.equal(merged.openai.model, "gpt-5.6-luna");
});

test("extractOutputText joins Chat Completions message content", () => {
  const response = {
    choices: [
      {
        message: { role: "assistant", content: "1. 第一项" },
      },
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "2. 第二项" }],
        },
      },
    ],
  };

  assert.equal(extractOutputText(response), "1. 第一项\n2. 第二项");
});

test("extractOutputText rejects missing text", () => {
  assert.throws(() => extractOutputText({ choices: [] }), /没有返回可用的整理结果/);
});

test("formatApiError includes the API message when available", () => {
  assert.equal(
    formatApiError(401, { error: { message: "Incorrect API key" } }),
    "阿里云百炼 API 请求失败（401）：Incorrect API key",
  );
  assert.equal(
    formatApiError(429, {}, API_PROVIDERS.OPENAI),
    "OpenAI API 请求失败（429）",
  );
});
