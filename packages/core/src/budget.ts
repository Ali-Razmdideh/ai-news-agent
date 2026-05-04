import { openDb } from "./db.js";
import { loadEnv } from "./env.js";

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function recordUsage(u: { model: string; stage: string; tokensIn: number; tokensOut: number }): void {
  const db = openDb();
  db.prepare(
    `INSERT INTO usage (day, model, stage, tokens_in, tokens_out, calls)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(day, model, stage) DO UPDATE SET
       tokens_in = tokens_in + excluded.tokens_in,
       tokens_out = tokens_out + excluded.tokens_out,
       calls = calls + 1`,
  ).run(utcDay(), u.model, u.stage, u.tokensIn, u.tokensOut);
}

export function tokensToday(): number {
  const row = openDb()
    .prepare("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS total FROM usage WHERE day = ?")
    .get(utcDay()) as { total: number };
  return row.total;
}

export function isOverBudget(): boolean {
  return tokensToday() >= loadEnv().DAILY_TOKEN_BUDGET;
}

export type CostRow = { model: string; stage: string; tokens_in: number; tokens_out: number; calls: number };
export function todayBreakdown(): CostRow[] {
  return openDb()
    .prepare(
      `SELECT model, stage, tokens_in, tokens_out, calls FROM usage WHERE day = ? ORDER BY tokens_in DESC`,
    )
    .all(utcDay()) as CostRow[];
}
