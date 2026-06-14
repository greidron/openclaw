import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  resolveSearchCount,
  resolveSearchTimeoutSeconds,
  wrapWebContent,
} from "openclaw/plugin-sdk/provider-web-search";

type PlaywrightMcpEngine = (typeof PLAYWRIGHT_MCP_ENGINES)[number];
type PlaywrightMcpMode = (typeof PLAYWRIGHT_MCP_MODES)[number];

type PlaywrightMcpSearchConfig = {
  playwrightMcp?: {
    defaultEngine?: string;
    includeNaverForProductSearch?: boolean;
    mode?: string;
  };
  timeoutSeconds?: number;
  count?: number;
};

type ExecutePlaywrightMcpWebSearchParams = {
  args: Record<string, unknown>;
  searchConfig: unknown;
  serverUrl: string;
  signal?: AbortSignal;
};

type PlaywrightMcpSearchRequest = {
  query: string;
  searchQueries: string[];
  count: number;
  country?: string;
  language?: string;
  freshness?: string;
  dateAfter?: string;
  dateBefore?: string;
  includeDomains: string[];
  excludeDomains: string[];
  mode?: PlaywrightMcpMode;
};

type BrowserSnapshotSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  sourceUrl: string;
  price?: string;
  mallName?: string;
  image?: string;
  rating?: string;
  reviewCount?: string;
  delivery?: string;
  category?: string;
  resultType?: "web" | "shopping";
};

type McpToolPlan =
  | { mode: "browser_workflow"; toolName: "browser_navigate"; canEvaluate: boolean }
  | { mode: "tool_call"; toolName: string };

const DEFAULT_PLAYWRIGHT_MCP_TOOL_NAME = "web_search";
const DEFAULT_PLAYWRIGHT_MCP_ENGINE = "google";
const PLAYWRIGHT_MCP_ENGINES = ["google", "duckduckgo", "bing", "naver"] as const;
const PLAYWRIGHT_MCP_MODES = ["auto", "browser", "tool"] as const;
const BROWSER_SEARCH_RESULT_EXTRACTION_FUNCTION = `() => {
  const visibleText = (node) => (node?.innerText || node?.textContent || "").replace(/\\s+/g, " ").trim();
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const entries = [];
  const seen = new Set();
  for (const anchor of anchors) {
    const href = anchor.href;
    if (!href || seen.has(href) || !/^https?:\\/\\//i.test(href)) continue;
    const url = new URL(href);
    if (["google.com", "www.google.com", "bing.com", "www.bing.com", "duckduckgo.com", "search.naver.com"].includes(url.hostname)) continue;
    const container = anchor.closest("article, li, div, section") || anchor.parentElement;
    const text = visibleText(container);
    const title = visibleText(anchor) || href;
    const snippet = text && text !== title ? text.replace(title, "").trim() : "";
    seen.add(href);
    entries.push({ title, url: href, snippet });
    if (entries.length >= 20) break;
  }
  return entries;
}`;
const NAVER_SEARCH_RESULT_EXTRACTION_FUNCTION = `() => {
  const text = (node) => (node?.innerText || node?.textContent || "").replace(/\\s+/g, " ").trim();
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const entries = [];
  const seen = new Set();
  for (const anchor of anchors) {
    const href = anchor.href;
    if (!href || seen.has(href) || !/^https?:\\/\\//i.test(href)) continue;
    const host = new URL(href).hostname;
    if (host.endsWith("naver.com")) continue;
    const container = anchor.closest("li, .bx, .total_wrap, section, article, div") || anchor.parentElement;
    const title = text(anchor) || href;
    const body = text(container);
    const snippet = body && body !== title ? body.replace(title, "").trim() : "";
    const resultType = /쇼핑|가격|최저가|구매|판매처|무료배송|[0-9][0-9,]*\\s*원/.test(body) ? "shopping" : "web";
    const price = ((body.match(/[0-9][0-9,]*\\s*원/) || [])[0] ?? "");
    const mallName = ((body.match(/(?:판매처|몰)\\s*([^\\s]+)/) || [])[1] ?? "");
    const reviewCount = ((body.match(/(?:리뷰|구매평|후기)\\s*([0-9,]+)/) || [])[1] ?? "");
    seen.add(href);
    entries.push({ title, url: href, snippet, price, mallName, reviewCount, resultType });
    if (entries.length >= 20) break;
  }
  return entries;
}`;
const PRODUCT_SEARCH_HINTS = [
  "상품",
  "제품",
  "가격",
  "최저가",
  "비교",
  "구매",
  "쇼핑",
  "후기",
  "review",
  "price",
  "buy",
  "deal",
  "best",
  "cheap",
  "cheapest",
  "discount",
  "sale",
  "coupon",
  "shipping",
  "mall",
  "store",
  "where to buy",
  "vs",
  "versus",
  "추천",
  "할인",
  "쿠폰",
  "배송",
  "무료배송",
  "판매처",
  "파는곳",
  "어디서",
  "싸게",
  "저렴",
  "가성비",
  "스펙",
  "모델",
];

export async function executePlaywrightMcpWebSearchProviderTool(
  params: ExecutePlaywrightMcpWebSearchParams,
): Promise<Record<string, unknown>> {
  throwIfAborted(params.signal);

  const searchConfig = readPlaywrightMcpSearchConfig(params.searchConfig);
  const request = readPlaywrightMcpSearchRequest(params.args, searchConfig);
  const timeoutSeconds = resolveSearchTimeoutSeconds(searchConfig);
  const defaultEngine = resolvePlaywrightMcpDefaultEngine(searchConfig);
  const mode = request.mode ?? resolvePlaywrightMcpMode(searchConfig);
  const includeNaverForProductSearch =
    resolvePlaywrightMcpIncludeNaverForProductSearch(searchConfig);
  const searchUrls = resolvePlaywrightMcpSearchUrls({
    request,
    defaultEngine,
    includeNaverForProductSearch,
  });

  const transport = new StreamableHTTPClientTransport(new URL(params.serverUrl), {
    requestInit: {
      headers: {
        Accept: "application/json, text/event-stream",
      },
    },
  });
  const client = new Client({
    name: "openclaw-playwright-mcp-web-search",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    throwIfAborted(params.signal);

    const availableToolNames = await listPlaywrightMcpToolNames(client);
    const toolPlan = resolvePlaywrightMcpToolPlan({
      requestedToolName: DEFAULT_PLAYWRIGHT_MCP_TOOL_NAME,
      availableToolNames,
      mode,
    });

    if (toolPlan.mode === "tool_call") {
      return runPlaywrightMcpDirectSearch({
        client,
        toolName: toolPlan.toolName,
        request,
        engine: defaultEngine,
        searchUrls,
        timeoutSeconds,
      });
    }

    try {
      return await runPlaywrightMcpBrowserSearch({
        client,
        request,
        engine: defaultEngine,
        searchUrls,
        availableToolNames,
        canEvaluate: toolPlan.canEvaluate,
        timeoutSeconds,
        signal: params.signal,
      });
    } catch (error) {
      if (mode === "auto" && availableToolNames.includes(DEFAULT_PLAYWRIGHT_MCP_TOOL_NAME)) {
        const payload = await runPlaywrightMcpDirectSearch({
          client,
          toolName: DEFAULT_PLAYWRIGHT_MCP_TOOL_NAME,
          request,
          engine: defaultEngine,
          searchUrls,
          timeoutSeconds,
        });
        return {
          ...payload,
          browserFallbackError: error instanceof Error ? error.message : String(error),
        };
      }
      throw error;
    }
  } finally {
    await client.close();
  }
}

async function runPlaywrightMcpDirectSearch(params: {
  client: Client;
  toolName: string;
  request: PlaywrightMcpSearchRequest;
  engine: PlaywrightMcpEngine;
  searchUrls: string[];
  timeoutSeconds: number;
}): Promise<Record<string, unknown>> {
  const payload = await callPlaywrightMcpTool(
    params.client,
    params.toolName,
    {
      query: params.request.query,
      count: params.request.count,
      search_queries: params.request.searchQueries,
      country: params.request.country,
      language: params.request.language,
      freshness: params.request.freshness,
      date_after: params.request.dateAfter,
      date_before: params.request.dateBefore,
      domain_filter: buildSignedDomainFilter(params.request),
      include_domains: params.request.includeDomains,
      exclude_domains: params.request.excludeDomains,
    },
    params.timeoutSeconds,
  );

  return {
    provider: "playwright-mcp",
    toolName: params.toolName,
    mode: "tool",
    query: params.request.query,
    count: params.request.count,
    engine: params.engine,
    searchUrls: params.searchUrls,
    filters: buildFilterMetadata(params.engine, params.request, "tool"),
    ...payload,
  };
}

async function runPlaywrightMcpBrowserSearch(params: {
  client: Client;
  request: PlaywrightMcpSearchRequest;
  engine: PlaywrightMcpEngine;
  searchUrls: string[];
  availableToolNames: string[];
  canEvaluate: boolean;
  timeoutSeconds: number;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const sections: string[] = [];
  const results: BrowserSnapshotSearchResult[] = [];
  for (const url of params.searchUrls) {
    throwIfAborted(params.signal);
    await callPlaywrightMcpTool(params.client, "browser_navigate", { url }, params.timeoutSeconds);
    if (params.availableToolNames.includes("browser_wait_for")) {
      await callPlaywrightMcpTool(
        params.client,
        "browser_wait_for",
        { time: 2 },
        params.timeoutSeconds,
      );
    }

    if (params.canEvaluate) {
      const evaluated = await tryExtractBrowserResultsWithEvaluate(
        params.client,
        url,
        params.timeoutSeconds,
      );
      if (evaluated.length) {
        results.push(...evaluated);
      }
    }

    const snapshot = await callPlaywrightMcpTool(
      params.client,
      "browser_snapshot",
      {},
      params.timeoutSeconds,
    );
    const snapshotText = stringifyMcpPayload(snapshot);
    sections.push(`## ${url}\n${snapshotText}`);
    results.push(...extractBrowserSnapshotResults(snapshotText, url));
  }

  return {
    provider: "playwright-mcp",
    toolName: params.canEvaluate ? "browser_evaluate+browser_snapshot" : "browser_snapshot",
    mode: "browser",
    query: params.request.query,
    count: params.request.count,
    engine: params.engine,
    searchUrls: params.searchUrls,
    filters: buildFilterMetadata(params.engine, params.request, "browser"),
    results: dedupeBrowserSnapshotResults(results).slice(0, params.request.count),
    naverShoppingResults: dedupeBrowserSnapshotResults(
      results.filter((result) => result.resultType === "shopping"),
    ).slice(0, params.request.count),
    content: wrapWebContent(sections.join("\n\n"), "web_search"),
  };
}

async function tryExtractBrowserResultsWithEvaluate(
  client: Client,
  sourceUrl: string,
  timeoutSeconds: number,
): Promise<BrowserSnapshotSearchResult[]> {
  try {
    const extractionFunction = resolveBrowserResultExtractionFunction(sourceUrl);
    const payload = await callPlaywrightMcpTool(
      client,
      "browser_evaluate",
      { function: extractionFunction },
      timeoutSeconds,
    );
    return normalizeExtractedBrowserResults(payload, sourceUrl);
  } catch {
    return [];
  }
}

async function listPlaywrightMcpToolNames(client: Client): Promise<string[]> {
  const response = await client.listTools();
  return response.tools.map((tool) => tool.name).filter((name) => name.trim());
}

async function callPlaywrightMcpTool(
  client: Client,
  toolName: string,
  args: Record<string, unknown>,
  timeoutSeconds: number,
): Promise<Record<string, unknown>> {
  const response = await client.callTool(
    {
      name: toolName,
      arguments: compactRecord(args),
    },
    undefined,
    { timeout: timeoutSeconds * 1000 },
  );
  return normalizeMcpToolResponse(response);
}

function resolvePlaywrightMcpToolPlan(params: {
  requestedToolName: string;
  availableToolNames: string[];
  mode: PlaywrightMcpMode;
}): McpToolPlan {
  const available = new Set(params.availableToolNames.map((name) => name.trim()).filter(Boolean));
  const hasBrowserWorkflow = available.has("browser_navigate") && available.has("browser_snapshot");
  if (params.mode !== "tool" && hasBrowserWorkflow) {
    return {
      mode: "browser_workflow",
      toolName: "browser_navigate",
      canEvaluate: available.has("browser_evaluate"),
    };
  }
  if (params.mode !== "browser" && available.has(params.requestedToolName)) {
    return { mode: "tool_call", toolName: params.requestedToolName };
  }

  throw new Error(
    `Playwright MCP server does not expose browser_navigate/browser_snapshot or ${params.requestedToolName}; available tools: ${
      Array.from(available).join(", ") || "(none)"
    }`,
  );
}

function resolvePlaywrightMcpSearchUrls(params: {
  request: PlaywrightMcpSearchRequest;
  defaultEngine: PlaywrightMcpEngine;
  includeNaverForProductSearch: boolean;
}): string[] {
  const urls = params.request.searchQueries.map((query) =>
    buildSearchUrl(params.defaultEngine, query, params.request),
  );
  if (params.includeNaverForProductSearch && isProductSearchQuery(params.request.query)) {
    urls.push(buildSearchUrl("naver", params.request.query, params.request));
  }
  return Array.from(new Set(urls));
}

function buildSearchUrl(
  engine: PlaywrightMcpEngine,
  query: string,
  request: PlaywrightMcpSearchRequest,
): string {
  const filteredQuery = buildFilteredQuery(query, request);
  switch (engine) {
    case "bing": {
      const url = new URL("https://www.bing.com/search");
      url.searchParams.set("q", filteredQuery);
      applyBingSearchParams(url, request);
      return url.toString();
    }
    case "duckduckgo": {
      const url = new URL("https://duckduckgo.com/");
      url.searchParams.set("q", filteredQuery);
      applyDuckDuckGoSearchParams(url, request);
      return url.toString();
    }
    case "naver": {
      const url = new URL("https://search.naver.com/search.naver");
      url.searchParams.set("query", filteredQuery);
      return url.toString();
    }
    case "google":
    default: {
      const url = new URL("https://www.google.com/search");
      url.searchParams.set("q", filteredQuery);
      applyGoogleSearchParams(url, request);
      return url.toString();
    }
  }
}

function resolvePlaywrightMcpDefaultEngine(config: PlaywrightMcpSearchConfig): PlaywrightMcpEngine {
  const fromConfig = normalizeEngine(config.playwrightMcp?.defaultEngine);
  if (fromConfig) {
    return fromConfig;
  }

  const fromEnv = normalizeEngine(process.env.PLAYWRIGHT_MCP_DEFAULT_ENGINE);
  return fromEnv ?? DEFAULT_PLAYWRIGHT_MCP_ENGINE;
}

function resolvePlaywrightMcpMode(config: PlaywrightMcpSearchConfig): PlaywrightMcpMode {
  const fromConfig = normalizeMode(config.playwrightMcp?.mode);
  if (fromConfig) {
    return fromConfig;
  }
  const fromEnv = normalizeMode(process.env.PLAYWRIGHT_MCP_MODE);
  return fromEnv ?? "auto";
}

function resolvePlaywrightMcpIncludeNaverForProductSearch(
  config: PlaywrightMcpSearchConfig,
): boolean {
  const configured = config.playwrightMcp?.includeNaverForProductSearch;
  if (typeof configured === "boolean") {
    return configured;
  }

  const fromEnv = process.env.PLAYWRIGHT_MCP_INCLUDE_NAVER_FOR_PRODUCT_SEARCH?.trim().toLowerCase();
  if (fromEnv === "true" || fromEnv === "1") {
    return true;
  }
  if (fromEnv === "false" || fromEnv === "0") {
    return false;
  }
  return true;
}

function normalizeEngine(value: string | undefined): PlaywrightMcpEngine | undefined {
  const normalized = value?.trim().toLowerCase();
  if (PLAYWRIGHT_MCP_ENGINES.includes(normalized as PlaywrightMcpEngine)) {
    return normalized as PlaywrightMcpEngine;
  }
  return undefined;
}

function normalizeMode(value: string | undefined): PlaywrightMcpMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (PLAYWRIGHT_MCP_MODES.includes(normalized as PlaywrightMcpMode)) {
    return normalized as PlaywrightMcpMode;
  }
  return undefined;
}

function isProductSearchQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return PRODUCT_SEARCH_HINTS.some((hint) => lower.includes(hint.toLowerCase()));
}

function readPlaywrightMcpSearchConfig(searchConfig: unknown): PlaywrightMcpSearchConfig {
  if (!searchConfig || typeof searchConfig !== "object") {
    return {};
  }
  return searchConfig as PlaywrightMcpSearchConfig;
}

function readPlaywrightMcpSearchRequest(
  args: Record<string, unknown>,
  searchConfig: PlaywrightMcpSearchConfig,
): PlaywrightMcpSearchRequest {
  const searchQueries = normalizeSearchQueries(readStringArray(args, "search_queries"));
  const query = readStringParam(args, "query") || searchQueries[0];
  if (!query) {
    throw new Error("query or search_queries is required.");
  }

  const includeDomains = normalizeDomains([
    ...readStringArray(args, "include_domains"),
    ...readSignedDomainFilter(args, "domain_filter").includeDomains,
  ]);
  const excludeDomains = normalizeDomains([
    ...readStringArray(args, "exclude_domains"),
    ...readSignedDomainFilter(args, "domain_filter").excludeDomains,
  ]);

  return {
    query,
    searchQueries: normalizeSearchQueries([query, ...searchQueries]),
    count: resolveSearchCount(readNumberParam(args, "count"), searchConfig),
    country: readStringParam(args, "country"),
    language: readStringParam(args, "language"),
    freshness: normalizeFreshnessParam(readStringParam(args, "freshness")),
    dateAfter: normalizeDateParam(readStringParam(args, "date_after"), "date_after"),
    dateBefore: normalizeDateParam(readStringParam(args, "date_before"), "date_before"),
    includeDomains,
    excludeDomains,
    mode: normalizeMode(readStringParam(args, "mode")),
  };
}

function normalizeMcpToolResponse(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== "object") {
    return { content: wrapWebContent(String(response ?? ""), "web_search") };
  }

  const record = response as Record<string, unknown>;
  const nestedResult = record.result;
  if (nestedResult && typeof nestedResult === "object") {
    return normalizeMcpToolResponse(nestedResult);
  }
  if (record.isError === true) {
    throw new Error(stringifyMcpPayload(record) || "Playwright MCP tool call failed");
  }
  if (record.structuredContent && typeof record.structuredContent === "object") {
    return record.structuredContent as Record<string, unknown>;
  }
  const text = stringifyMcpPayload(record);
  const mcpResult = parseMcpMarkdownResult(text);
  if (mcpResult) {
    return normalizeMcpToolResponse(mcpResult);
  }
  const parsed = parseJsonObject(text);
  if (parsed) {
    return parsed;
  }
  const parsedArray = parseJsonArray(text);
  if (parsedArray) {
    return { results: parsedArray };
  }
  return { content: wrapWebContent(text, "web_search") };
}

function stringifyMcpPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return String(payload ?? "");
  }

  const record = payload as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const textValue = (entry as Record<string, unknown>).text;
        return typeof textValue === "string" ? textValue : "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) {
      return text;
    }
  }

  return JSON.stringify(payload);
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === "") {
        return false;
      }
      if (Array.isArray(value) && value.length === 0) {
        return false;
      }
      return true;
    }),
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error ? signal.reason : new Error("Playwright MCP search aborted");
}

function normalizeSearchQueries(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function readSignedDomainFilter(
  args: Record<string, unknown>,
  key: string,
): { includeDomains: string[]; excludeDomains: string[] } {
  const includeDomains: string[] = [];
  const excludeDomains: string[] = [];
  for (const raw of readStringArray(args, key)) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    if (value.startsWith("-")) {
      excludeDomains.push(value.slice(1));
    } else {
      includeDomains.push(value);
    }
  }
  return { includeDomains, excludeDomains };
}

function readStringArray(args: Record<string, unknown>, key: string): string[] {
  return readStringArrayParam(args, key) ?? [];
}

function normalizeDomains(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) =>
          value
            .trim()
            .replace(/^https?:\/\//i, "")
            .replace(/\/.*$/, ""),
        )
        .filter(Boolean),
    ),
  );
}

function buildSignedDomainFilter(request: PlaywrightMcpSearchRequest): string[] {
  return [...request.includeDomains, ...request.excludeDomains.map((domain) => `-${domain}`)];
}

function buildFilteredQuery(query: string, request: PlaywrightMcpSearchRequest): string {
  const domainFilters = [
    ...request.includeDomains.map((domain) => `site:${domain}`),
    ...request.excludeDomains.map((domain) => `-site:${domain}`),
  ];
  return [query, ...domainFilters].join(" ").trim();
}

function normalizeFreshnessParam(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["day", "week", "month", "year", "pd", "pw", "pm", "py"].includes(normalized)) {
    return normalized;
  }
  throw new Error("freshness must be day, week, month, year, pd, pw, pm, or py.");
}

function normalizeDateParam(value: string | undefined, name: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${name} must be YYYY-MM-DD format.`);
  }
  return normalized;
}

function applyGoogleSearchParams(url: URL, request: PlaywrightMcpSearchRequest): void {
  if (request.country) {
    url.searchParams.set("gl", request.country.toLowerCase());
  }
  if (request.language) {
    url.searchParams.set("hl", request.language.toLowerCase());
  }
  const tbs = googleTimeSearchParam(request);
  if (tbs) {
    url.searchParams.set("tbs", tbs);
  }
}

function applyBingSearchParams(url: URL, request: PlaywrightMcpSearchRequest): void {
  if (request.country) {
    url.searchParams.set("cc", request.country.toLowerCase());
  }
  if (request.language) {
    url.searchParams.set("setlang", request.language.toLowerCase());
  }
  const freshness = bingFreshnessParam(request.freshness);
  if (freshness) {
    url.searchParams.set("filters", freshness);
  }
}

function applyDuckDuckGoSearchParams(url: URL, request: PlaywrightMcpSearchRequest): void {
  const freshness = duckDuckGoFreshnessParam(request.freshness);
  if (freshness) {
    url.searchParams.set("df", freshness);
  }
}

function googleTimeSearchParam(request: PlaywrightMcpSearchRequest): string | undefined {
  if (request.dateAfter || request.dateBefore) {
    const after = request.dateAfter ? toGoogleCdrDate(request.dateAfter) : undefined;
    const before = request.dateBefore ? toGoogleCdrDate(request.dateBefore) : undefined;
    return ["cdr:1", after ? `cd_min:${after}` : undefined, before ? `cd_max:${before}` : undefined]
      .filter(Boolean)
      .join(",");
  }
  switch (request.freshness) {
    case "day":
    case "pd":
      return "qdr:d";
    case "week":
    case "pw":
      return "qdr:w";
    case "month":
    case "pm":
      return "qdr:m";
    case "year":
    case "py":
      return "qdr:y";
    default:
      return undefined;
  }
}

function bingFreshnessParam(freshness: string | undefined): string | undefined {
  switch (freshness) {
    case "day":
    case "pd":
      return 'ex1:"ez1"';
    case "week":
    case "pw":
      return 'ex1:"ez2"';
    case "month":
    case "pm":
      return 'ex1:"ez3"';
    default:
      return undefined;
  }
}

function duckDuckGoFreshnessParam(freshness: string | undefined): string | undefined {
  switch (freshness) {
    case "day":
    case "pd":
      return "d";
    case "week":
    case "pw":
      return "w";
    case "month":
    case "pm":
      return "m";
    case "year":
    case "py":
      return "y";
    default:
      return undefined;
  }
}

function toGoogleCdrDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
}

function extractBrowserSnapshotResults(
  snapshotText: string,
  sourceUrl: string,
): BrowserSnapshotSearchResult[] {
  const lines = snapshotText.split(/\r?\n/);
  const results: BrowserSnapshotSearchResult[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const url of extractUrls(line)) {
      if (seen.has(url)) {
        continue;
      }
      seen.add(url);
      const title =
        cleanSnapshotTitle(line.replace(url, "")) || cleanSnapshotTitle(lines[index - 1]);
      const snippet = cleanSnapshotSnippet(lines[index + 1]);
      results.push({
        title: title || url,
        url,
        ...(snippet ? { snippet } : {}),
        sourceUrl,
      });
    }
  }
  return results;
}

function extractUrls(value: string): string[] {
  return Array.from(value.matchAll(/https?:\/\/[^\s\])"'<>]+/g), (match) =>
    match[0].replace(/[.,;:]+$/, ""),
  );
}

function cleanSnapshotTitle(value: string | undefined): string {
  return (value ?? "")
    .replace(/^[-*\s]+/, "")
    .replace(/\b(link|heading|button)\b/gi, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSnapshotSnippet(value: string | undefined): string | undefined {
  const snippet = cleanSnapshotTitle(value);
  return snippet && !/^https?:\/\//i.test(snippet) ? snippet : undefined;
}

function dedupeBrowserSnapshotResults(
  results: BrowserSnapshotSearchResult[],
): BrowserSnapshotSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.url)) {
      return false;
    }
    seen.add(result.url);
    return true;
  });
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonArray(text: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseMcpMarkdownResult(text: string): unknown | undefined {
  const match = text.match(/^### Result\s*\n([\s\S]*?)(?:\n### Ran Playwright code|\n```|$)/);
  if (!match) {
    return undefined;
  }
  const resultText = match[1]?.trim();
  if (!resultText) {
    return undefined;
  }
  try {
    return JSON.parse(resultText);
  } catch {
    return resultText;
  }
}

function normalizeExtractedBrowserResults(
  payload: Record<string, unknown>,
  sourceUrl: string,
): BrowserSnapshotSearchResult[] {
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  return rawResults
    .map((entry) => normalizeExtractedBrowserResult(entry, sourceUrl))
    .filter((entry): entry is BrowserSnapshotSearchResult => entry !== undefined);
}

function normalizeExtractedBrowserResult(
  entry: unknown,
  sourceUrl: string,
): BrowserSnapshotSearchResult | undefined {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) {
    return undefined;
  }
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : url;
  const snippet =
    typeof record.snippet === "string" && record.snippet.trim() ? record.snippet.trim() : undefined;
  const resultType = record.resultType === "shopping" ? "shopping" : "web";
  return {
    title,
    url,
    ...(snippet ? { snippet } : {}),
    sourceUrl,
    ...(readOptionalString(record.price) ? { price: readOptionalString(record.price) } : {}),
    ...(readOptionalString(record.mallName)
      ? { mallName: readOptionalString(record.mallName) }
      : {}),
    ...(readOptionalString(record.image) ? { image: readOptionalString(record.image) } : {}),
    ...(readOptionalString(record.rating) ? { rating: readOptionalString(record.rating) } : {}),
    ...(readOptionalString(record.reviewCount)
      ? { reviewCount: readOptionalString(record.reviewCount) }
      : {}),
    ...(readOptionalString(record.delivery)
      ? { delivery: readOptionalString(record.delivery) }
      : {}),
    ...(readOptionalString(record.category)
      ? { category: readOptionalString(record.category) }
      : {}),
    resultType,
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveBrowserResultExtractionFunction(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname === "search.naver.com") {
      return NAVER_SEARCH_RESULT_EXTRACTION_FUNCTION;
    }
  } catch {
    // Fall through to the generic extractor for malformed source labels.
  }
  return BROWSER_SEARCH_RESULT_EXTRACTION_FUNCTION;
}

function buildFilterMetadata(
  engine: PlaywrightMcpEngine,
  request: PlaywrightMcpSearchRequest,
  executionMode: "browser" | "tool",
): Record<string, unknown> {
  const requested = compactRecord({
    country: request.country,
    language: request.language,
    freshness: request.freshness,
    date_after: request.dateAfter,
    date_before: request.dateBefore,
    include_domains: request.includeDomains,
    exclude_domains: request.excludeDomains,
  });
  if (executionMode === "tool") {
    return {
      requested,
      applied: requested,
      unsupported: {},
    };
  }

  const applied = compactRecord({
    country: ["google", "bing"].includes(engine) ? request.country : undefined,
    language: ["google", "bing"].includes(engine) ? request.language : undefined,
    freshness: ["google", "bing", "duckduckgo"].includes(engine) ? request.freshness : undefined,
    date_after: engine === "google" ? request.dateAfter : undefined,
    date_before: engine === "google" ? request.dateBefore : undefined,
    include_domains: request.includeDomains,
    exclude_domains: request.excludeDomains,
  });
  return {
    requested,
    applied,
    unsupported: diffFilterMetadata(requested, applied),
  };
}

function diffFilterMetadata(
  requested: Record<string, unknown>,
  applied: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(requested).filter(([key]) => !(key in applied)));
}

export const __playwrightMcpWebSearchProviderTestInternals = {
  buildFilterMetadata,
  buildSearchUrl,
  dedupeBrowserSnapshotResults,
  extractBrowserSnapshotResults,
  normalizeExtractedBrowserResults,
  normalizeMcpToolResponse,
  parseMcpMarkdownResult,
  readPlaywrightMcpSearchRequest,
  resolveBrowserResultExtractionFunction,
  resolvePlaywrightMcpMode,
  resolvePlaywrightMcpSearchUrls,
};
