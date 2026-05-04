import { describe, it, expect, beforeEach, vi } from "vitest";

function setBaseEnv() {
  process.env.TELEGRAM_BOT_TOKEN = "123:abc";
  process.env.TELEGRAM_CHANNEL_ID = "-100";
  process.env.TELEGRAM_DISCUSSION_GROUP_ID = "-200";
  process.env.ADMIN_TG_USER_ID = "1";
  process.env.AI_NEWS_DB = ":memory:";
  process.env.MODEL_LOW = "";
  process.env.MODEL_MID = "";
  process.env.MODEL_HIGH = "";
}

describe("modelFor", () => {
  beforeEach(() => {
    vi.resetModules();
    setBaseEnv();
  });

  it("uses Anthropic defaults when LLM_PROVIDER=anthropic", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    process.env.OPENAI_API_KEY = "";
    const { modelFor } = await import("../packages/core/src/llm.js");
    expect(modelFor("low")).toBe("claude-haiku-4-5");
    expect(modelFor("mid")).toBe("claude-sonnet-4-6");
    expect(modelFor("high")).toBe("claude-opus-4-7");
  });

  it("uses OpenAI defaults when LLM_PROVIDER=openai (low=gpt-5-mini, high=gpt-5)", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-oai-x";
    process.env.ANTHROPIC_API_KEY = "";
    const { modelFor } = await import("../packages/core/src/llm.js");
    expect(modelFor("low")).toBe("gpt-5-mini");
    expect(modelFor("mid")).toBe("gpt-5-mini");
    expect(modelFor("high")).toBe("gpt-5");
  });

  it("respects per-tier env overrides", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-oai-x";
    process.env.MODEL_LOW = "gpt-4o-mini";
    process.env.MODEL_HIGH = "o3";
    const { modelFor } = await import("../packages/core/src/llm.js");
    expect(modelFor("low")).toBe("gpt-4o-mini");
    expect(modelFor("mid")).toBe("gpt-5-mini");
    expect(modelFor("high")).toBe("o3");
  });

  it("rejects provider=openai with no key", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "";
    process.env.ANTHROPIC_API_KEY = "";
    const { loadEnv } = await import("../packages/core/src/env.js");
    expect(() => loadEnv()).toThrow(/OPENAI_API_KEY/);
  });
});
