import { describe, expect, it } from "vitest";
import { __playwrightMcpWebSearchProviderTestInternals as internals } from "./playwright-mcp-web-search-provider.runtime.js";

describe("playwright MCP web search provider runtime", () => {
  it("builds Google URLs with domain, country, language, and date filters", () => {
    const request = internals.readPlaywrightMcpSearchRequest(
      {
        query: "openclaw plugin sdk",
        country: "US",
        language: "en",
        date_after: "2026-06-01",
        date_before: "2026-06-14",
        include_domains: ["docs.openclaw.ai/path"],
        exclude_domains: ["https://spam.example/nope"],
      },
      {},
    );

    const url = new URL(internals.buildSearchUrl("google", request.query, request));

    expect(url.hostname).toBe("www.google.com");
    expect(url.searchParams.get("q")).toBe(
      "openclaw plugin sdk site:docs.openclaw.ai -site:spam.example",
    );
    expect(url.searchParams.get("gl")).toBe("us");
    expect(url.searchParams.get("hl")).toBe("en");
    expect(url.searchParams.get("tbs")).toBe("cdr:1,cd_min:06/01/2026,cd_max:06/14/2026");
  });

  it("reports unsupported browser filters by engine", () => {
    const request = internals.readPlaywrightMcpSearchRequest(
      {
        query: "latest openclaw",
        freshness: "week",
        date_after: "2026-06-01",
        country: "KR",
        include_domains: ["openclaw.ai"],
      },
      {},
    );

    expect(internals.buildFilterMetadata("naver", request, "browser")).toEqual({
      requested: {
        country: "KR",
        freshness: "week",
        date_after: "2026-06-01",
        include_domains: ["openclaw.ai"],
      },
      applied: {
        include_domains: ["openclaw.ai"],
      },
      unsupported: {
        country: "KR",
        freshness: "week",
        date_after: "2026-06-01",
      },
    });
  });

  it("normalizes MCP nested JSON text responses", () => {
    expect(
      internals.normalizeMcpToolResponse({
        result: {
          content: [{ type: "text", text: JSON.stringify({ results: [{ title: "A" }] }) }],
        },
      }),
    ).toEqual({ results: [{ title: "A" }] });
  });

  it("extracts structured results from browser evaluate payloads", () => {
    expect(
      internals.normalizeExtractedBrowserResults(
        {
          results: [
            {
              title: "OpenClaw docs",
              url: "https://docs.openclaw.ai/tools/web",
              snippet: "Web search provider docs",
            },
            { title: "bad", url: "javascript:void(0)" },
          ],
        },
        "https://www.google.com/search?q=openclaw",
      ),
    ).toEqual([
      {
        title: "OpenClaw docs",
        url: "https://docs.openclaw.ai/tools/web",
        snippet: "Web search provider docs",
        sourceUrl: "https://www.google.com/search?q=openclaw",
      },
    ]);
  });

  it("extracts and deduplicates URL results from browser snapshots", () => {
    const results = internals.extractBrowserSnapshotResults(
      [
        'link "OpenClaw" https://github.com/openclaw/openclaw',
        "OpenClaw repository",
        'link "OpenClaw duplicate" https://github.com/openclaw/openclaw',
        'link "Docs" https://docs.openclaw.ai/tools/web',
      ].join("\n"),
      "https://www.google.com/search?q=openclaw",
    );

    expect(internals.dedupeBrowserSnapshotResults(results)).toEqual([
      {
        title: "OpenClaw",
        url: "https://github.com/openclaw/openclaw",
        snippet: "OpenClaw repository",
        sourceUrl: "https://www.google.com/search?q=openclaw",
      },
      {
        title: "Docs",
        url: "https://docs.openclaw.ai/tools/web",
        sourceUrl: "https://www.google.com/search?q=openclaw",
      },
    ]);
  });

  it("defaults to auto mode and accepts explicit browser/tool modes", () => {
    expect(internals.resolvePlaywrightMcpMode({})).toBe("auto");
    expect(internals.readPlaywrightMcpSearchRequest({ query: "x", mode: "browser" }, {}).mode).toBe(
      "browser",
    );
    expect(internals.readPlaywrightMcpSearchRequest({ query: "x", mode: "tool" }, {}).mode).toBe(
      "tool",
    );
  });
});
