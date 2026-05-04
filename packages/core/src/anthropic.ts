// Back-compat shim. The provider abstraction now lives in ./llm.ts.
export { complete, modelFor, type Tier, type CompleteArgs, type CompleteResult } from "./llm.js";
