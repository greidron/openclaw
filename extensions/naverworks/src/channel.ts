import {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  registerPluginHttpRoute,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { listAccountIds, resolveAccount } from "./accounts.js";
import { getNaverWorksRuntime } from "./runtime.js";
import { createNaverWorksWebhookHandler } from "./webhook-handler.js";

const CHANNEL_ID = "naverworks";

const NaverWorksConfigSchema = buildChannelConfigSchema(
  z
    .object({
      dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).optional(),
      allowFrom: z.array(z.string()).optional(),
      webhookPath: z.string().optional(),
      botName: z.string().optional(),
      strictBinding: z.boolean().optional(),
    })
    .passthrough(),
);

const activeRouteUnregisters = new Map<string, () => void>();

export function createNaverWorksPlugin() {
  return {
    id: CHANNEL_ID,

    meta: {
      id: CHANNEL_ID,
      label: "NAVER WORKS",
      selectionLabel: "NAVER WORKS (Webhook)",
      detailLabel: "NAVER WORKS (Webhook)",
      docsPath: "/channels/naverworks",
      blurb: "NAVER WORKS DM-first channel plugin with per-user agent routing.",
      order: 92,
    },

    capabilities: {
      chatTypes: ["direct" as const],
      media: false,
      threads: false,
      reactions: false,
      edit: false,
      unsend: false,
      reply: false,
      effects: false,
      blockStreaming: false,
    },

    reload: { configPrefixes: ["channels.naverworks", "bindings", "agents"] },

    configSchema: NaverWorksConfigSchema,

    config: {
      listAccountIds: (cfg: any) => listAccountIds(cfg),
      resolveAccount: (cfg: any, accountId?: string | null) => resolveAccount(cfg, accountId),
      defaultAccountId: () => DEFAULT_ACCOUNT_ID,
      setAccountEnabled: ({ cfg, accountId, enabled }: any) =>
        setAccountEnabledInConfigSection({
          cfg,
          sectionKey: "channels.naverworks",
          accountId,
          enabled,
        }),
    },

    gateway: {
      startAccount: async (ctx: any) => {
        const { cfg, accountId, log } = ctx;
        const account = resolveAccount(cfg, accountId);
        if (!account.enabled) {
          return { stop: () => {} };
        }

        const routeKey = `${account.accountId}:${account.webhookPath}`;
        const prev = activeRouteUnregisters.get(routeKey);
        if (prev) {
          prev();
          activeRouteUnregisters.delete(routeKey);
        }

        const handler = createNaverWorksWebhookHandler({
          account,
          log,
          deliver: async (event) => {
            const runtime = getNaverWorksRuntime();
            const freshCfg = await runtime.config.loadConfig();
            const route = runtime.channel.routing.resolveAgentRoute({
              cfg: freshCfg,
              channel: CHANNEL_ID,
              accountId: account.accountId,
              teamId: event.teamId,
              peer: { kind: "direct", id: event.userId },
            });

            if (account.strictBinding && route.matchedBy === "default") {
              log?.warn?.(
                `naverworks: strictBinding dropped event for ${event.userId} (no matching binding)`,
              );
              return;
            }

            const msgCtx = {
              Body: event.text,
              BodyForAgent: event.text,
              RawBody: event.text,
              CommandBody: event.text,
              From: `naverworks:${event.userId}`,
              To: `naverworks:${account.accountId}`,
              SessionKey: route.sessionKey,
              AccountId: route.accountId,
              ChatType: "direct",
              SenderName: event.senderName,
              SenderId: event.userId,
              Provider: CHANNEL_ID,
              Surface: CHANNEL_ID,
              OriginatingChannel: CHANNEL_ID,
              OriginatingTo: `naverworks:${account.accountId}`,
            };

            await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: msgCtx,
              cfg: freshCfg,
              dispatcherOptions: {
                onReplyStart: () => {
                  log?.info?.(`naverworks: reply started for ${event.userId} (${route.agentId})`);
                },
                // Phase 1: inbound/routing only. Outbound API integration comes next phase.
                deliver: async (payload: { text?: string; body?: string }) => {
                  const text = payload?.text ?? payload?.body;
                  if (text) {
                    log?.info?.(`naverworks phase1 outbound placeholder: ${text.slice(0, 120)}`);
                  }
                },
              },
            });
          },
        });

        const unregister = registerPluginHttpRoute({
          path: account.webhookPath,
          pluginId: CHANNEL_ID,
          accountId: account.accountId,
          log: (line: string) => log?.info?.(line),
          handler,
        });
        activeRouteUnregisters.set(routeKey, unregister);

        return {
          stop: () => {
            unregister();
            activeRouteUnregisters.delete(routeKey);
          },
        };
      },
      stopAccount: async () => {},
    },
  };
}
