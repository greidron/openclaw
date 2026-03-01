import {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  registerPluginHttpRoute,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { listAccountIds, resolveAccount } from "./accounts.js";
import { getNaverWorksRuntime } from "./runtime.js";
import { sendMessageNaverWorks } from "./send.js";
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
      botId: z.string().optional(),
      accessToken: z.string().optional(),
      apiBaseUrl: z.string().optional(),
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
      reply: true,
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
        log?.info?.(`naverworks[${accountId ?? DEFAULT_ACCOUNT_ID}]: start requested`);
        const account = resolveAccount(cfg, accountId);
        log?.info?.(
          `naverworks[${account.accountId}]: resolved config (enabled=${account.enabled}, webhookPath=${account.webhookPath}, dmPolicy=${account.dmPolicy}, strictBinding=${account.strictBinding}, outboundConfigured=${Boolean(account.botId && account.accessToken)})`,
        );
        if (!account.enabled) {
          log?.info?.(`naverworks[${account.accountId}]: disabled; skipping start`);
          return { stop: () => {} };
        }

        const routeKey = `${account.accountId}:${account.webhookPath}`;
        const prev = activeRouteUnregisters.get(routeKey);
        if (prev) {
          log?.info?.(
            `naverworks[${account.accountId}]: replacing existing webhook route ${account.webhookPath}`,
          );
          prev();
          activeRouteUnregisters.delete(routeKey);
        }

        const handler = createNaverWorksWebhookHandler({
          account,
          log,
          deliver: async (event) => {
            log?.info?.(
              `naverworks[${account.accountId}]: processing inbound event userId=${event.userId}${event.teamId ? ` teamId=${event.teamId}` : ""}`,
            );
            const runtime = getNaverWorksRuntime();
            const freshCfg = await runtime.config.loadConfig();
            const route = runtime.channel.routing.resolveAgentRoute({
              cfg: freshCfg,
              channel: CHANNEL_ID,
              accountId: account.accountId,
              teamId: event.teamId,
              peer: { kind: "direct", id: event.userId },
            });
            log?.info?.(
              `naverworks[${account.accountId}]: route resolved agentId=${route.agentId} matchedBy=${route.matchedBy} sessionKey=${route.sessionKey}${event.teamId ? ` teamId=${event.teamId}` : ""}`,
            );

            if (account.strictBinding && route.matchedBy === "default") {
              log?.warn?.(
                `naverworks: strictBinding dropped event for ${event.userId}${event.teamId ? ` teamId=${event.teamId}` : ""} (no matching binding)`,
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
                deliver: async (payload: { text?: string; body?: string }) => {
                  const text = payload?.text ?? payload?.body;
                  if (!text) {
                    return;
                  }

                  const sent = await sendMessageNaverWorks({
                    account,
                    toUserId: event.userId,
                    text,
                  });

                  if (!sent.ok) {
                    if (sent.reason === "not-configured") {
                      log?.warn?.(
                        `naverworks[${account.accountId}]: outbound skipped (set botId/accessToken to enable delivery)`,
                      );
                      return;
                    }
                    log?.error?.(
                      `naverworks[${account.accountId}]: outbound send failed status=${sent.status ?? "unknown"} body=${sent.body?.slice(0, 300) ?? ""}`,
                    );
                    return;
                  }

                  log?.info?.(
                    `naverworks[${account.accountId}]: outbound delivered to ${event.userId}`,
                  );
                },
              },
            });
            log?.info?.(
              `naverworks[${account.accountId}]: inbound event handled for ${event.userId} (agent=${route.agentId})`,
            );
          },
        });

        const unregister = registerPluginHttpRoute({
          path: account.webhookPath,
          pluginId: CHANNEL_ID,
          accountId: account.accountId,
          log: (line: string) => log?.info?.(line),
          handler,
        });
        log?.info?.(
          `naverworks[${account.accountId}]: webhook route registered at ${account.webhookPath}`,
        );
        activeRouteUnregisters.set(routeKey, unregister);

        try {
          // Webhook mode is passive; keep account task alive until the runtime aborts it.
          await new Promise<void>((resolve) => {
            if (ctx.abortSignal.aborted) {
              resolve();
              return;
            }
            ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
          });
        } finally {
          log?.info?.(
            `naverworks[${account.accountId}]: abort received; unregistering webhook route`,
          );
          unregister();
          activeRouteUnregisters.delete(routeKey);
        }
      },
      stopAccount: async () => {},
    },
  };
}
