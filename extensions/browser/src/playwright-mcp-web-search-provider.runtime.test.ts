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

  it("normalizes MCP markdown-wrapped browser evaluate responses", () => {
    expect(
      internals.normalizeMcpToolResponse({
        content: [
          {
            type: "text",
            text: [
              "### Result",
              JSON.stringify([{ title: "OpenClaw", url: "https://docs.openclaw.ai/tools/web" }]),
              "### Ran Playwright code",
              "await page.evaluate(...)",
            ].join("\n"),
          },
        ],
      }),
    ).toEqual({ results: [{ title: "OpenClaw", url: "https://docs.openclaw.ai/tools/web" }] });
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
        resultType: "web",
        sourceUrl: "https://www.google.com/search?q=openclaw",
      },
    ]);
  });

  it("uses Google plus Naver browser fallback when Naver API credentials are absent", () => {
    const request = internals.readPlaywrightMcpSearchRequest(
      {
        query: "OpenClaw Playwright MCP",
      },
      {},
    );

    expect(
      internals.resolvePlaywrightMcpSearchUrls({
        request,
        defaultEngine: "google",
        includeNaverBrowserFallback: true,
        naverApiAvailable: false,
      }),
    ).toEqual([
      "https://www.google.com/search?q=OpenClaw+Playwright+MCP",
      "https://search.naver.com/search.naver?query=OpenClaw+Playwright+MCP",
    ]);
  });

  it("uses Google browser search without Naver browser fallback when Naver API is available", () => {
    const request = internals.readPlaywrightMcpSearchRequest(
      {
        query: "맥북 에어 m4 최저가 어디서 사는게 좋아?",
      },
      {},
    );

    expect(
      internals.resolvePlaywrightMcpSearchUrls({
        request,
        defaultEngine: "google",
        includeNaverBrowserFallback: true,
        naverApiAvailable: true,
      }),
    ).toEqual([
      "https://www.google.com/search?q=%EB%A7%A5%EB%B6%81+%EC%97%90%EC%96%B4+m4+%EC%B5%9C%EC%A0%80%EA%B0%80+%EC%96%B4%EB%94%94%EC%84%9C+%EC%82%AC%EB%8A%94%EA%B2%8C+%EC%A2%8B%EC%95%84%3F",
    ]);
  });

  it("normalizes shopping-like Naver search evaluate fields", () => {
    expect(
      internals.normalizeExtractedBrowserResults(
        {
          results: [
            {
              title: "MacBook Air M4",
              url: "https://shopping.naver.com/catalog/123",
              snippet: "MacBook Air M4 13 inch",
              price: "1,390,000원",
              mallName: "Apple 공식스토어",
              image: "https://img.example/macbook.jpg",
              rating: "4.8",
              reviewCount: "1,234",
              delivery: "무료배송",
              category: "노트북",
              resultType: "shopping",
            },
          ],
        },
        "https://search.naver.com/search.naver?query=macbook",
      ),
    ).toEqual([
      {
        title: "MacBook Air M4",
        url: "https://shopping.naver.com/catalog/123",
        snippet: "MacBook Air M4 13 inch",
        price: "1,390,000원",
        mallName: "Apple 공식스토어",
        image: "https://img.example/macbook.jpg",
        rating: "4.8",
        reviewCount: "1,234",
        delivery: "무료배송",
        category: "노트북",
        resultType: "shopping",
        sourceUrl: "https://search.naver.com/search.naver?query=macbook",
      },
    ]);
  });

  it("normalizes Naver Shopping API results", () => {
    expect(
      internals.normalizeNaverShoppingApiResults({
        items: [
          {
            title: "<b>MacBook</b> Air M4",
            link: "https://search.shopping.naver.com/catalog/123",
            image: "https://img.example/macbook.jpg",
            lprice: "1390000",
            hprice: "1490000",
            mallName: "Apple 공식스토어",
            brand: "Apple",
            category1: "디지털/가전",
            category2: "노트북",
          },
          { title: "bad", link: "javascript:void(0)" },
        ],
      }),
    ).toEqual([
      {
        title: "MacBook Air M4",
        url: "https://search.shopping.naver.com/catalog/123",
        snippet: "최저가 1,390,000원 · 최고가 1,490,000원 · 브랜드 Apple · 디지털/가전 > 노트북",
        sourceUrl: "https://openapi.naver.com/v1/search/shop.json",
        price: "1,390,000원",
        mallName: "Apple 공식스토어",
        image: "https://img.example/macbook.jpg",
        category: "디지털/가전 > 노트북",
        resultType: "shopping",
      },
    ]);
  });

  it("normalizes Naver web API results", () => {
    expect(
      internals.normalizeNaverWebApiResults({
        items: [
          {
            title: "<b>MacBook</b> Air 13(M4, 2025년)",
            link: "https://namu.wiki/w/MacBook%20Air%2013",
            description: "<b>MacBook</b> technical summary",
          },
        ],
      }),
    ).toEqual([
      {
        title: "MacBook Air 13(M4, 2025년)",
        url: "https://namu.wiki/w/MacBook%20Air%2013",
        snippet: "MacBook technical summary",
        sourceUrl: "https://openapi.naver.com/v1/search/webkr.json",
        resultType: "web",
      },
    ]);
  });

  it("merges Naver API results ahead of browser results", () => {
    const shoppingResults = internals.normalizeNaverShoppingApiResults({
      items: [
        {
          title: "MacBook Air M4",
          link: "https://search.shopping.naver.com/catalog/123",
          lprice: "1390000",
        },
      ],
    });
    const webResults = internals.normalizeNaverWebApiResults({
      items: [
        {
          title: "MacBook Air 13(M4, 2025년)",
          link: "https://namu.wiki/w/MacBook%20Air%2013",
        },
      ],
    });

    expect(
      internals.mergeNaverApiResults(
        {
          results: [
            {
              title: "Docs",
              url: "https://docs.openclaw.ai/tools/web",
              sourceUrl: "https://www.google.com/search?q=macbook",
            },
          ],
        },
        { webResults, shoppingResults },
        5,
      ),
    ).toMatchObject({
      results: [
        {
          title: "MacBook Air M4",
          url: "https://search.shopping.naver.com/catalog/123",
          resultType: "shopping",
        },
        {
          title: "MacBook Air 13(M4, 2025년)",
          url: "https://namu.wiki/w/MacBook%20Air%2013",
          resultType: "web",
        },
        {
          title: "Docs",
          url: "https://docs.openclaw.ai/tools/web",
        },
      ],
      naverWebApiResults: [
        {
          title: "MacBook Air 13(M4, 2025년)",
          url: "https://namu.wiki/w/MacBook%20Air%2013",
        },
      ],
      naverShoppingApiResults: [
        {
          title: "MacBook Air M4",
          url: "https://search.shopping.naver.com/catalog/123",
        },
      ],
    });
  });

  it("only treats purchase-intent queries as Naver Shopping API searches", () => {
    expect(internals.isShoppingSearchQuery("맥북 에어 m4 최저가 어디서 사는게 좋아?")).toBe(true);
    expect(internals.isShoppingSearchQuery("맥북 에어 m4 스펙 비교")).toBe(false);
  });

  it("selects the general Naver browser evaluate extractor", () => {
    expect(
      internals.resolveBrowserResultExtractionFunction(
        "https://search.naver.com/search.naver?query=openclaw",
      ),
    ).toContain("resultType");
    expect(
      internals.resolveBrowserResultExtractionFunction(
        "https://search.shopping.naver.com/search/all?query=macbook",
      ),
    ).not.toContain("판매처");
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

  it("resolves Naver API credentials from config", () => {
    expect(
      internals.resolveNaverApiCredentials({
        playwrightMcp: {
          naverApi: {
            clientId: "client-id",
            clientSecret: "client-secret",
          },
        },
      }),
    ).toEqual({ clientId: "client-id", clientSecret: "client-secret" });
    expect(
      internals.resolveNaverApiCredentials({
        playwrightMcp: {
          naverApi: {
            enabled: false,
            clientId: "client-id",
            clientSecret: "client-secret",
          },
        },
      }),
    ).toBeUndefined();
  });
});
