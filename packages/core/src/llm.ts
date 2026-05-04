import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { loadEnv } from "./env.js";
import { recordUsage, isOverBudget } from "./budget.js";

/**
 * Provider-neutral tier names. The actual model used per tier is configurable
 * via env vars (MODEL_LOW / MODEL_MID / MODEL_HIGH), with sensible defaults
 * per provider. Tiers map roughly to:
 *   low  — fast/cheap (default scoring, default summaries)
 *   mid  — better reasoning (summary retry on low confidence)
 *   high — most capable (code-heavy items, hard QA)
 */
export type Tier = "low" | "mid" | "high";

const DEFAULTS: Record<"anthropic" | "openai", Record<Tier, string>> = {
  anthropic: {
    low: "claude-haiku-4-5",
    mid: "claude-sonnet-4-6",
    high: "claude-opus-4-7",
  },
  openai: {
    low: "gpt-5-mini",
    mid: "gpt-5-mini",
    high: "gpt-5",
  },
};

export function modelFor(tier: Tier): string {
  const env = loadEnv();
  const override =
    tier === "low" ? env.MODEL_LOW : tier === "mid" ? env.MODEL_MID : env.MODEL_HIGH;
  if (override) return override;
  return DEFAULTS[env.LLM_PROVIDER][tier];
}

let anthropicClient: Anthropic | undefined;
let openaiClient: OpenAI | undefined;

function getAnthropic(): Anthropic {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: loadEnv().ANTHROPIC_API_KEY });
  return anthropicClient;
}

function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: loadEnv().OPENAI_API_KEY });
  return openaiClient;
}

export type CompleteArgs = {
  tier: Tier;
  system: string;
  user: string;
  stage: string;
  maxTokens?: number;
  temperature?: number;
};

export type CompleteResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: "anthropic" | "openai";
};

export async function complete(args: CompleteArgs): Promise<CompleteResult> {
  if (isOverBudget()) throw new Error("daily_token_budget_exceeded");
  const env = loadEnv();
  const model = modelFor(args.tier);
  const provider = env.LLM_PROVIDER;

  if (provider === "anthropic") {
    const res = await getAnthropic().messages.create({
      model,
      max_tokens: args.maxTokens ?? 1024,
      temperature: args.temperature ?? 0.2,
      // cache_control is supported by the API but typings lag in some SDK versions.
      system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } } as unknown as { type: "text"; text: string }],
      messages: [{ role: "user", content: args.user }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
    const usage = res.usage as unknown as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    const tokensIn =
      usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    const tokensOut = usage.output_tokens;
    recordUsage({ model, stage: args.stage, tokensIn, tokensOut });
    return { text, tokensIn, tokensOut, model, provider };
  }

  // OpenAI (Responses API). gpt-5* models use `max_output_tokens`.
  const res = await getOpenAI().responses.create({
    model,
    instructions: args.system,
    input: args.user,
    max_output_tokens: args.maxTokens ?? 1024,
    temperature: args.temperature ?? 0.2,
  });
  const text = (res as { output_text?: string }).output_text ?? "";
  const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage ?? {};
  const tokensIn = usage.input_tokens ?? 0;
  const tokensOut = usage.output_tokens ?? 0;
  recordUsage({ model, stage: args.stage, tokensIn, tokensOut });
  return { text, tokensIn, tokensOut, model, provider };
}
