import { z } from "zod";

const Env = z.object({
  // LLM provider — at least one of ANTHROPIC_API_KEY / OPENAI_API_KEY must be set.
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  OPENAI_API_KEY: z.string().optional().default(""),

  // Per-tier model overrides. Empty string → use provider default.
  MODEL_LOW: z.string().optional().default(""),
  MODEL_MID: z.string().optional().default(""),
  MODEL_HIGH: z.string().optional().default(""),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHANNEL_ID: z.string().regex(/^-?\d+$/),
  TELEGRAM_DISCUSSION_GROUP_ID: z.string().regex(/^-?\d+$/),
  ADMIN_TG_USER_ID: z.string().regex(/^\d+$/),
  GITHUB_TOKEN: z.string().optional().default(""),
  VOYAGE_API_KEY: z.string().optional().default(""),
  AI_NEWS_DB: z.string().default("/data/news.db"),
  DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().default(2_000_000),
  MAX_POSTS_PER_HOUR: z.coerce.number().int().positive().default(8),
  QA_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(10),
  TIMEZONE: z.string().default("Asia/Tehran"),
  DRY_RUN: z.coerce.number().int().min(0).max(1).default(0),
});

export type AppEnv = z.infer<typeof Env>;

let cached: AppEnv | undefined;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${issues.join("\n  ")}`);
  }
  const data = parsed.data;
  if (data.LLM_PROVIDER === "anthropic" && !data.ANTHROPIC_API_KEY) {
    throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty");
  }
  if (data.LLM_PROVIDER === "openai" && !data.OPENAI_API_KEY) {
    throw new Error("LLM_PROVIDER=openai but OPENAI_API_KEY is empty");
  }
  cached = data;
  return cached;
}
