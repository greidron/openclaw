import type { WebSearchProviderPlugin } from "openclaw/plugin-sdk/provider-web-search-contract";
import { createWebSearchProviderContractFields } from "openclaw/plugin-sdk/provider-web-search-contract";

export function createPlaywrightMcpWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "playwright-mcp",
    label: "Playwright MCP",
    hint: "Searches the web through a configured Playwright MCP server.",
    requiresCredential: false,
    autoDetectOrder: 50,
    docsUrl: "https://docs.openclaw.ai/tools/web",
    ...createWebSearchProviderContractFields({
      credentialPath: "",
      searchCredential: { type: "scoped", scopeId: "playwright-mcp" },
      selectionPluginId: "browser",
    }),
    createTool(ctx) {
      const serverUrl = resolvePlaywrightMcpServerUrl(ctx.searchConfig);
      if (!serverUrl) {
        return null;
      }

      return {
        name: "web_search",
        description: "Search the web through a Playwright MCP server.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              description: "Search query.",
            },
            count: {
              type: "number",
              description: "Maximum number of results to return.",
            },
            country: {
              type: "string",
              description: "Optional country or region hint.",
            },
            language: {
              type: "string",
              description: "Optional language hint.",
            },
            freshness: {
              type: "string",
              description: "Optional freshness hint.",
            },
            date_after: {
              type: "string",
              description: "Optional lower date bound.",
            },
            date_before: {
              type: "string",
              description: "Optional upper date bound.",
            },
          },
          required: ["query"],
        },
        async execute(args, runCtx) {
          const mod = await import("./src/playwright-mcp-web-search-provider.runtime.js");
          return mod.executePlaywrightMcpWebSearchProviderTool({
            args,
            signal: runCtx.signal,
            searchConfig: ctx.searchConfig,
            serverUrl,
          });
        },
      };
    },
  };
}

function resolvePlaywrightMcpServerUrl(searchConfig: unknown): string | undefined {
  const configured = readPlaywrightMcpConfigValue(searchConfig, "serverUrl");
  if (configured) {
    return configured;
  }

  const fromEnv = process.env.PLAYWRIGHT_MCP_SERVER_URL?.trim();
  return fromEnv || undefined;
}

function readPlaywrightMcpConfigValue(searchConfig: unknown, key: string): string | undefined {
  if (!searchConfig || typeof searchConfig !== "object") {
    return undefined;
  }

  const config = (searchConfig as { playwrightMcp?: unknown }).playwrightMcp;
  if (!config || typeof config !== "object") {
    return undefined;
  }

  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
