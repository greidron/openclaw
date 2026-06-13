import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  readNumberParam,
  readStringParam,
  resolveSearchCount,
  resolveSearchTimeoutSeconds,
  wrapWebContent,
} from "openclaw/plugin-sdk/provider-web-search";

type PlaywrightMcpEngine = (typeof PLAYWRIGHT_MCP_ENGINES)[number];

type PlaywrightMcpSearchConfig = {
  playwrightMcp?: {
    defaultEngine?: string;
    includeNaverForProductSearch?: boolean;
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

type McpToolPlan =
  | { mode: "browser_workflow"; toolName: "browser_navigate" }
  | { mode: "tool_call"; toolName: string };

const DEFAULT_PLAYWRIGHT_MCP_TOOL_NAME = "web_search";
const DEFAULT_PLAYWRIGHT_MCP_ENGINE = "google";
const PLAYWRIGHT_MCP_ENGINES = ["google", "duckduckgo", "bing", "naver"] as const;
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
];

export async function executePlaywrightMcpWebSearchProviderTool(
  params: ExecutePlaywrightMcpWebSearchParams,
): Promise<Record<string, unknown>> {
  throwIfAborted(params.signal);

  const query = readStringParam(params.args, "query", { required: true });
  const searchConfig = readPlaywrightMcpSearchConfig(params.searchConfig);
  const count = resolveSearchCount(readNumberParam(params.args, "count"), searchConfig);
  const timeoutSeconds = resolveSearchTimeoutSeconds(searchConfig);
  const defaultEngine = resolvePlaywrightMcpDefaultEngine(searchConfig);
  const includeNaverForProductSearch =
    resolvePlaywrightMcpIncludeNaverForProductSearch(searchConfig);
  const searchUrls = resolvePlaywrightMcpSearchUrls({
    query,
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
    });

    if (toolPlan.mode === "tool_call") {
      const payload = await callPlaywrightMcpTool(
        client,
        toolPlan.toolName,
        {
          query,
          count,
          country: readStringParam(params.args, "country"),
          language: readStringParam(params.args, "language"),
          freshness: readStringParam(params.args, "freshness"),
          date_after: readStringParam(params.args, "date_after"),
          date_before: readStringParam(params.args, "date_before"),
        },
        timeoutSeconds,
      );

      return {
        provider: "playwright-mcp",
        toolName: toolPlan.toolName,
        query,
        count,
        engine: defaultEngine,
        searchUrls,
        ...payload,
      };
    }

    const sections: string[] = [];
    for (const url of searchUrls) {
      throwIfAborted(params.signal);
      await callPlaywrightMcpTool(client, "browser_navigate", { url }, timeoutSeconds);
      if (availableToolNames.includes("browser_wait_for")) {
        await callPlaywrightMcpTool(client, "browser_wait_for", { time: 2 }, timeoutSeconds);
      }
      const snapshot = await callPlaywrightMcpTool(client, "browser_snapshot", {}, timeoutSeconds);
      sections.push(`## ${url}\n${stringifyMcpPayload(snapshot)}`);
    }

    return {
      provider: "playwright-mcp",
      toolName: "browser_snapshot",
      query,
      count,
      engine: defaultEngine,
      searchUrls,
      content: wrapWebContent(sections.join("\n\n"), "web_search"),
    };
  } finally {
    await client.close();
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
}): McpToolPlan {
  const available = new Set(params.availableToolNames.map((name) => name.trim()).filter(Boolean));
  if (available.has("browser_navigate") && available.has("browser_snapshot")) {
    return { mode: "browser_workflow", toolName: "browser_navigate" };
  }
  if (available.has(params.requestedToolName)) {
    return { mode: "tool_call", toolName: params.requestedToolName };
  }

  throw new Error(
    `Playwright MCP server does not expose browser_navigate/browser_snapshot or ${params.requestedToolName}; available tools: ${
      Array.from(available).join(", ") || "(none)"
    }`,
  );
}

function resolvePlaywrightMcpSearchUrls(params: {
  query: string;
  defaultEngine: PlaywrightMcpEngine;
  includeNaverForProductSearch: boolean;
}): string[] {
  const urls = [buildSearchUrl(params.defaultEngine, params.query)];
  if (params.includeNaverForProductSearch && isProductSearchQuery(params.query)) {
    urls.push(buildSearchUrl("naver", params.query));
  }
  return Array.from(new Set(urls));
}

function buildSearchUrl(engine: PlaywrightMcpEngine, query: string): string {
  const encoded = encodeURIComponent(query);
  switch (engine) {
    case "bing":
      return `https://www.bing.com/search?q=${encoded}`;
    case "duckduckgo":
      return `https://duckduckgo.com/?q=${encoded}`;
    case "naver":
      return `https://search.naver.com/search.naver?query=${encoded}`;
    case "google":
    default:
      return `https://www.google.com/search?q=${encoded}`;
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

function normalizeMcpToolResponse(response: unknown): Record<string, unknown> {
  if (!response || typeof response !== "object") {
    return { content: wrapWebContent(String(response ?? ""), "web_search") };
  }

  const record = response as Record<string, unknown>;
  if (record.isError === true) {
    throw new Error(stringifyMcpPayload(record) || "Playwright MCP tool call failed");
  }
  if (record.structuredContent && typeof record.structuredContent === "object") {
    return record.structuredContent as Record<string, unknown>;
  }
  return { content: wrapWebContent(stringifyMcpPayload(record), "web_search") };
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
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error ? signal.reason : new Error("Playwright MCP search aborted");
}
