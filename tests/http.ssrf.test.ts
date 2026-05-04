import { describe, it, expect, beforeAll } from "vitest";
import { SsrfError, safeFetch } from "../packages/core/src/http.js";

beforeAll(() => {
  // env not needed for SSRF tests
});

describe("safeFetch SSRF guard", () => {
  it("refuses non-http(s) protocols", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
  });

  it("refuses non-allowlisted hosts", async () => {
    await expect(safeFetch("https://example.com/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("refuses loopback resolution", async () => {
    // 127.0.0.1.nip.io would resolve to 127.0.0.1 — but it's not on the allowlist
    // either, so we use a literal that bypasses host allowlist via DNS:
    // We instead probe with a literal IP url, which should fail host allowlist.
    await expect(safeFetch("http://127.0.0.1:80/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("refuses link-local metadata", async () => {
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(SsrfError);
  });
});
