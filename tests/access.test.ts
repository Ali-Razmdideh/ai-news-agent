import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.TELEGRAM_BOT_TOKEN = "123:abc";
  process.env.TELEGRAM_CHANNEL_ID = "-1001111111111";
  process.env.TELEGRAM_DISCUSSION_GROUP_ID = "-1002222222222";
  process.env.ADMIN_TG_USER_ID = "42";
  process.env.AI_NEWS_DB = ":memory:";
});

describe("checkInbound", () => {
  it("allows admin DM", async () => {
    const { checkInbound } = await import("../packages/core/src/access.js");
    expect(checkInbound({ kind: "dm", chatId: "42", userId: "42" }).allow).toBe(true);
  });

  it("denies non-admin DM", async () => {
    const { checkInbound } = await import("../packages/core/src/access.js");
    expect(checkInbound({ kind: "dm", chatId: "999", userId: "999" }).allow).toBe(false);
  });

  it("denies any message in the broadcast channel", async () => {
    const { checkInbound } = await import("../packages/core/src/access.js");
    const env = process.env;
    expect(
      checkInbound({ kind: "channel", chatId: env.TELEGRAM_CHANNEL_ID!, userId: "42" }).allow,
    ).toBe(false);
  });

  it("denies group messages without a mention", async () => {
    const { checkInbound } = await import("../packages/core/src/access.js");
    const env = process.env;
    const r = checkInbound({
      kind: "group",
      chatId: env.TELEGRAM_DISCUSSION_GROUP_ID!,
      userId: "42",
      isMention: false,
    });
    expect(r.allow).toBe(false);
    if (!r.allow) expect(r.reason).toBe("group_no_mention");
  });

  it("denies non-allowlisted groups even when @-mentioned", async () => {
    const { checkInbound } = await import("../packages/core/src/access.js");
    expect(
      checkInbound({ kind: "group", chatId: "-1009", userId: "42", isMention: true }).allow,
    ).toBe(false);
  });

  it("allows admin in the discussion group with mention", async () => {
    const { checkInbound } = await import("../packages/core/src/access.js");
    const env = process.env;
    expect(
      checkInbound({
        kind: "group",
        chatId: env.TELEGRAM_DISCUSSION_GROUP_ID!,
        userId: "42",
        isMention: true,
      }).allow,
    ).toBe(true);
  });
});
