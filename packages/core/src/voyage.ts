import { loadEnv } from "./env.js";
import { safeFetchJson } from "./http.js";

const MODEL = "voyage-3-lite";

type VoyageResp = { data: Array<{ embedding: number[] }> };

export async function embed(texts: string[]): Promise<number[][]> {
  const env = loadEnv();
  if (!env.VOYAGE_API_KEY) {
    // No-op fallback: zero vectors keep the pipeline running for dev/tests.
    return texts.map(() => Array(256).fill(0));
  }
  const res = await safeFetchJson<VoyageResp>("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, input: texts, output_dimension: 256, output_dtype: "float" }),
    timeoutMs: 20_000,
  });
  return res.data.map((d) => d.embedding);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
