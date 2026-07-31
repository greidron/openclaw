import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { toLocationContext } from "openclaw/plugin-sdk/channel-inbound";
import {
  buildChannelConfigSchema,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk/core";
import { resolveOutboundMediaUrls } from "openclaw/plugin-sdk/reply-payload";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/routing";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import { z } from "zod";
import { listAccountIds, resolveAccount } from "./accounts.js";
import { getNaverWorksRuntime } from "./runtime.js";
import { resolveNaverWorksAccessToken, sendMessageNaverWorks } from "./send.js";
import type { NaverWorksSendDelivery } from "./send.js";
import type { NaverWorksAccount } from "./types.js";
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
      botSecret: z.string().optional(),
      botId: z.string().optional(),
      accessToken: z.string().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      serviceAccount: z.string().optional(),
      privateKey: z.string().optional(),
      scope: z.string().optional(),
      tokenUrl: z.string().optional(),
      jwtIssuer: z.string().optional(),
      apiBaseUrl: z.string().optional(),
      markdownMode: z.enum(["plain", "auto-flex"]).optional(),
      autoThinking: z
        .object({
          enabled: z.boolean().optional(),
          defaultLevel: z.enum(["low", "medium", "high"]).optional(),
          lowKeywords: z.array(z.string()).optional(),
          highKeywords: z.array(z.string()).optional(),
        })
        .optional(),
      progressMessages: z
        .object({
          enabled: z.boolean().optional(),
          text: z.string().optional(),
          texts: z.array(z.string()).optional(),
          intervalMs: z.number().int().positive().optional(),
          emojis: z.array(z.string()).optional(),
        })
        .optional(),
      statusStickers: z
        .object({
          enabled: z.boolean().optional(),
        })
        .optional(),
      debugSummary: z
        .object({
          enabled: z.boolean().optional(),
          includeCosts: z.boolean().optional(),
        })
        .optional(),
    })
    .passthrough(),
);

const activeRouteUnregisters = new Map<string, () => void>();
const INLINE_THINK_DIRECTIVE_RE = /(^|\s)\/(?:think|thinking|t)(?::|\s|$)/i;
const FAILED_REPLY_NOTICE = "처리에 실패했습니다. 잠시 후 다시 시도해주세요.";
const debugSummaryOverrides = new Map<string, "on" | "off" | "once">();

type AutoThinkingLevel = "low" | "medium" | "high";
type NaverWorksChannelOutboundContext = {
  cfg: OpenClawConfig;
  to: string;
  text?: string;
  mediaUrl?: string;
  accountId?: string | null;
};

type DebugSummaryDecision = {
  enabled: boolean;
  mode: "config" | "on" | "off" | "once";
};

type NaverWorksDebugCommand =
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "once" }
  | { kind: "status" };

function getDebugSummaryOverrideKey(accountId: string, userId: string): string {
  return `${accountId}\u0000${userId}`;
}

export function parseNaverWorksDebugCommand(text?: string): NaverWorksDebugCommand | undefined {
  const normalized = text?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const match = /^\/debug(?:\s+(\S+))?$/.exec(normalized);
  if (!match) {
    return undefined;
  }
  const action = match[1] ?? "status";
  if (action === "on" || action === "enable" || action === "enabled") {
    return { kind: "on" };
  }
  if (action === "off" || action === "disable" || action === "disabled") {
    return { kind: "off" };
  }
  if (action === "once" || action === "one") {
    return { kind: "once" };
  }
  if (action === "status" || action === "state") {
    return { kind: "status" };
  }
  return { kind: "status" };
}

function resolveDebugSummaryDecision(params: {
  account: ReturnType<typeof resolveAccount>;
  userId: string;
  consumeOnce?: boolean;
}): DebugSummaryDecision {
  const key = getDebugSummaryOverrideKey(params.account.accountId, params.userId);
  const override = debugSummaryOverrides.get(key);
  if (override === "once") {
    if (params.consumeOnce) {
      debugSummaryOverrides.delete(key);
    }
    return { enabled: true, mode: "once" };
  }
  if (override === "on") {
    return { enabled: true, mode: "on" };
  }
  if (override === "off") {
    return { enabled: false, mode: "off" };
  }
  return {
    enabled: params.account.debugSummary?.enabled === true,
    mode: "config",
  };
}

function formatDebugStatus(params: {
  account: ReturnType<typeof resolveAccount>;
  userId: string;
}): string {
  const decision = resolveDebugSummaryDecision({
    account: params.account,
    userId: params.userId,
  });
  return [
    "🧪 디버그 상태",
    `- account: ${params.account.accountId}`,
    `- target: naverworks:${params.userId}`,
    `- mode: ${decision.mode}`,
    `- config default: ${params.account.debugSummary?.enabled ? "enabled" : "disabled"}`,
    `- include costs: ${params.account.debugSummary?.includeCosts !== false ? "yes" : "no"}`,
    `- next reply: ${decision.enabled ? "will show" : "hidden"}`,
  ].join("\n");
}

async function handleDebugCommand(params: {
  account: ReturnType<typeof resolveAccount>;
  userId: string;
  command: NaverWorksDebugCommand;
  log?: {
    warn?: (...args: unknown[]) => void;
  };
}): Promise<void> {
  const key = getDebugSummaryOverrideKey(params.account.accountId, params.userId);
  if (params.command.kind === "on") {
    debugSummaryOverrides.set(key, "on");
  } else if (params.command.kind === "off") {
    debugSummaryOverrides.set(key, "off");
  } else if (params.command.kind === "once") {
    debugSummaryOverrides.set(key, "once");
  }
  const sent = await sendMessageNaverWorks({
    account: params.account,
    toUserId: params.userId,
    text: formatDebugStatus({ account: params.account, userId: params.userId }),
  });
  if (!sent.ok) {
    params.log?.warn?.(
      `naverworks[${params.account.accountId}]: failed to send debug command response to ${params.userId} (reason=${sent.reason}, status=${sent.status ?? "unknown"}, body=${sent.body?.slice(0, 300) ?? ""})`,
    );
  }
}

function formatDeliveryLog(delivery: NaverWorksSendDelivery): string {
  return [
    `contentType=${delivery.contentType}`,
    `viaAttachmentUpload=${delivery.viaAttachmentUpload ? "yes" : "no"}`,
    `mediaKind=${delivery.mediaKind ?? "none"}`,
    `uploadedFileId=${delivery.uploadedFileId ? "yes" : "no"}`,
    `remoteMediaUrl=${delivery.remoteMediaUrl ? "yes" : "no"}`,
  ].join(" ");
}

function resolveAutoThinkingLevel(params: {
  text?: string;
  account: ReturnType<typeof resolveAccount>;
}): AutoThinkingLevel | undefined {
  const text = params.text?.trim();
  if (!text || !params.account.autoThinking?.enabled) {
    return undefined;
  }
  if (INLINE_THINK_DIRECTIVE_RE.test(text)) {
    return undefined;
  }

  const normalized = text.toLowerCase();
  const { highKeywords = [], lowKeywords = [] } = params.account.autoThinking;
  if (highKeywords.some((keyword) => keyword && normalized.includes(keyword.toLowerCase()))) {
    return "high";
  }
  if (lowKeywords.some((keyword) => keyword && normalized.includes(keyword.toLowerCase()))) {
    return "low";
  }
  return params.account.autoThinking.defaultLevel;
}

export function resolveAutoThinkingDirective(params: {
  text?: string;
  account: ReturnType<typeof resolveAccount>;
}): string | undefined {
  const level = resolveAutoThinkingLevel(params);
  return level ? `/think ${level}` : undefined;
}

function selectProgressEmoji(account: ReturnType<typeof resolveAccount>): string {
  const emojis = account.progressMessages?.emojis.filter((emoji) => emoji.trim()) ?? [];
  if (emojis.length === 0) {
    return "🕒";
  }
  const index = Math.floor(Math.random() * emojis.length);
  return emojis[index] ?? "🕒";
}

function selectProgressText(account: ReturnType<typeof resolveAccount>): string {
  const texts = account.progressMessages?.texts.filter((text) => text.trim()) ?? [];
  if (texts.length === 0) {
    return account.progressMessages?.text.trim() ?? "";
  }
  const index = Math.floor(Math.random() * texts.length);
  return texts[index] ?? account.progressMessages?.text.trim() ?? "";
}

type NaverWorksReplyUsageSummary = {
  provider?: string;
  model?: string;
  resolvedRef?: string;
  requested?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  lastUsage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  turnUsd?: number;
  durationMs?: number;
  fallbackUsed?: boolean;
  reasoningEffort?: string;
};

function formatNumber(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatUsd(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
}

function formatDebugUsageLine(
  label: string,
  usage: NaverWorksReplyUsageSummary["usage"] | undefined,
): string | undefined {
  if (!usage) {
    return undefined;
  }
  const parts = [
    `in ${formatNumber(usage.input) ?? "?"}`,
    `out ${formatNumber(usage.output) ?? "?"}`,
    usage.cacheRead ? `cache read ${formatNumber(usage.cacheRead)}` : undefined,
    usage.cacheWrite ? `cache write ${formatNumber(usage.cacheWrite)}` : undefined,
    `total ${formatNumber(usage.total) ?? "?"}`,
  ].filter(Boolean);
  return `🔢 ${label}: ${parts.join(" / ")}`;
}

function formatNaverWorksDebugSummary(params: {
  account: ReturnType<typeof resolveAccount>;
  enabled: boolean;
  usage?: NaverWorksReplyUsageSummary;
}): string | undefined {
  if (!params.enabled) {
    return undefined;
  }
  const usage = params.usage;
  if (!usage) {
    return "디버그 정보\n- usage unavailable";
  }
  const model =
    usage.resolvedRef ??
    (usage.provider && usage.model ? `${usage.provider}/${usage.model}` : "unknown");
  const lines = [
    "🧪 디버그 정보",
    [
      `🤖 model: ${model}`,
      usage.requested && usage.requested !== usage.resolvedRef
        ? `requested ${usage.requested}`
        : undefined,
      usage.reasoningEffort ? `thinking ${usage.reasoningEffort}` : undefined,
    ]
      .filter(Boolean)
      .join(" / "),
    usage.fallbackUsed ? "🔁 fallback: used" : undefined,
    formatDebugUsageLine("tokens", usage.usage),
    [
      usage.durationMs ? `⏱️ duration: ${(usage.durationMs / 1000).toFixed(1)}s` : undefined,
      params.account.debugSummary?.includeCosts !== false
        ? `cost ${formatUsd(usage.turnUsd) ?? "unavailable"}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" / "),
  ].filter(Boolean);
  return lines.join("\n");
}

async function sendProgressMessage(params: {
  account: ReturnType<typeof resolveAccount>;
  userId: string;
  log?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
}): Promise<void> {
  const progress = params.account.progressMessages;
  if (!progress?.enabled) {
    params.log?.info?.(
      `naverworks[${params.account.accountId}]: progress message skipped (progressMessages disabled)`,
    );
    return;
  }
  const text = selectProgressText(params.account).trim();
  if (!text) {
    return;
  }
  const message = `${selectProgressEmoji(params.account)} ${text}`;

  params.log?.info?.(
    `naverworks[${params.account.accountId}]: sending progress message to ${params.userId}`,
  );

  try {
    const sent = await sendMessageNaverWorks({
      account: params.account,
      toUserId: params.userId,
      text: message,
    });
    if (!sent.ok) {
      params.log?.warn?.(
        `naverworks[${params.account.accountId}]: failed to send progress message to ${params.userId} (reason=${sent.reason}, status=${sent.status ?? "unknown"}, body=${sent.body?.slice(0, 300) ?? ""})`,
      );
      return;
    }
    params.log?.info?.(
      `naverworks[${params.account.accountId}]: sent progress message to ${params.userId}`,
    );
  } catch (error) {
    params.log?.error?.(
      `naverworks[${params.account.accountId}]: progress message send threw userId=${params.userId}: ${String(error)}`,
    );
  }
}

function startProgressMessageHeartbeat(params: {
  account: ReturnType<typeof resolveAccount>;
  userId: string;
  log?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
}): () => Promise<void> {
  const intervalMs = params.account.progressMessages?.intervalMs ?? 60_000;
  params.log?.info?.(
    `naverworks[${params.account.accountId}]: starting progress message heartbeat for ${params.userId} intervalMs=${intervalMs}`,
  );
  let stopped = false;
  let pendingSend = Promise.resolve();
  const enqueueProgressMessage = () => {
    pendingSend = pendingSend.then(() => {
      if (stopped) {
        return;
      }
      return sendProgressMessage({
        account: params.account,
        userId: params.userId,
        log: params.log,
      });
    });
    pendingSend.catch(() => {});
  };

  enqueueProgressMessage();
  const timer = setInterval(() => {
    enqueueProgressMessage();
  }, intervalMs);

  return async () => {
    if (stopped) {
      await pendingSend;
      return;
    }
    stopped = true;
    clearInterval(timer);
    await pendingSend;
    params.log?.info?.(
      `naverworks[${params.account.accountId}]: stopped progress message heartbeat for ${params.userId}`,
    );
  };
}

function hasNaverWorksOutboundAuth(account: ReturnType<typeof resolveAccount>): boolean {
  if (account.accessToken?.trim()) {
    return true;
  }
  return Boolean(
    account.clientId?.trim() &&
    account.clientSecret?.trim() &&
    account.serviceAccount?.trim() &&
    account.privateKey,
  );
}

function isNaverWorksConfigured(account: ReturnType<typeof resolveAccount>): boolean {
  return Boolean(account.botId?.trim()) && hasNaverWorksOutboundAuth(account);
}

function defaultInboundMediaType(kind?: string): string | undefined {
  if (kind === "image") return "image/jpeg";
  if (kind === "audio") return "audio/mpeg";
  if (kind === "file") return "application/octet-stream";
  return undefined;
}

function buildAttachmentEndpoint(params: {
  account: ReturnType<typeof resolveAccount>;
  fileId: string;
}): string {
  return `${params.account.apiBaseUrl.replace(/\/$/, "")}/bots/${encodeURIComponent(
    params.account.botId ?? "",
  )}/attachments/${encodeURIComponent(params.fileId)}`;
}

function isNaverWorksStorageHost(hostname: string): boolean {
  return (
    hostname === "storage.worksmobile.com" ||
    hostname.endsWith(".storage.worksmobile.com") ||
    hostname === "apis-storage.worksmobile.com" ||
    hostname.endsWith(".apis-storage.worksmobile.com")
  );
}

function shouldAuthenticateDirectMediaUrl(params: {
  account: ReturnType<typeof resolveAccount>;
  url: string;
}): boolean {
  try {
    return new URL(params.url).origin === new URL(params.account.apiBaseUrl).origin;
  } catch {
    return false;
  }
}

export async function resolveNaverWorksAttachmentDownloadUrl(params: {
  account: ReturnType<typeof resolveAccount>;
  fileId: string;
  headers: Record<string, string>;
}): Promise<string> {
  const endpoint = buildAttachmentEndpoint({ account: params.account, fileId: params.fileId });
  const response = await fetch(endpoint, {
    method: "GET",
    headers: params.headers,
    redirect: "manual",
  });
  const location = response.headers.get("location")?.trim();
  if (!location || ![301, 302, 303, 307, 308].includes(response.status)) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `NAVER WORKS attachment redirect failed status=${response.status} body=${body.slice(0, 300)}`,
    );
  }

  const resolved = new URL(location, endpoint);
  if (resolved.protocol !== "https:" || !isNaverWorksStorageHost(resolved.hostname)) {
    throw new Error(
      `NAVER WORKS attachment redirect used unsupported destination ${resolved.origin}`,
    );
  }
  return resolved.href;
}

export async function downloadNaverWorksInboundMedia(params: {
  runtime: ReturnType<typeof getNaverWorksRuntime>;
  account: ReturnType<typeof resolveAccount>;
  event: {
    mediaUrl?: string;
    mediaFileId?: string;
    mediaMimeType?: string;
    mediaFileName?: string;
    mediaKind?: string;
  };
  log?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
}): Promise<{ path?: string; mediaType?: string }> {
  const mediaUrl = params.event.mediaUrl?.trim();
  const mediaFileId = params.event.mediaFileId?.trim();
  if (!mediaUrl && !mediaFileId) {
    return {};
  }
  const fallbackMediaType =
    params.event.mediaMimeType ?? defaultInboundMediaType(params.event.mediaKind);

  const maxBytes = 20 * 1024 * 1024;
  const headers: Record<string, string> = {};
  const accessToken = await resolveNaverWorksAccessToken(params.account);
  if (accessToken.ok) {
    headers.Authorization = `Bearer ${accessToken.token}`;
  } else {
    params.log?.warn?.(
      `naverworks[${params.account.accountId}]: inbound media fetch proceeding without bot auth (status=${accessToken.status ?? "unknown"})`,
    );
  }

  try {
    let fetchUrl = mediaUrl;
    let fetchInit =
      mediaUrl && shouldAuthenticateDirectMediaUrl({ account: params.account, url: mediaUrl })
        ? { headers }
        : undefined;
    if (!mediaUrl && mediaFileId && !params.account.botId?.trim()) {
      params.log?.warn?.(
        `naverworks[${params.account.accountId}]: inbound media fileId download skipped because botId is not configured`,
      );
      return { mediaType: fallbackMediaType };
    }
    if (!fetchUrl && mediaFileId) {
      fetchUrl = await resolveNaverWorksAttachmentDownloadUrl({
        account: params.account,
        fileId: mediaFileId,
        headers,
      });
      fetchInit = Object.keys(headers).length > 0 ? { headers } : undefined;
    }
    if (!fetchUrl) {
      return { mediaType: fallbackMediaType };
    }

    const fetched = await params.runtime.channel.media.fetchRemoteMedia({
      url: fetchUrl,
      maxBytes,
      requestInit: fetchInit,
    });
    const saved = await params.runtime.channel.media.saveMediaBuffer(
      fetched.buffer,
      fetched.contentType ?? fallbackMediaType,
      "inbound",
      maxBytes,
      fetched.fileName ??
        params.event.mediaFileName ??
        (mediaFileId
          ? `naverworks-${params.event.mediaKind ?? "attachment"}`
          : params.event.mediaKind),
    );
    return {
      path: saved.path,
      mediaType: saved.contentType ?? fetched.contentType ?? fallbackMediaType,
    };
  } catch (error) {
    params.log?.error?.(
      `naverworks[${params.account.accountId}]: failed to download inbound media ${mediaUrl ? "url" : mediaFileId ? "fileId" : "unknown"}: ${String(error)}`,
    );
    return { mediaType: fallbackMediaType };
  }
}

export function createNaverWorksPlugin(): ChannelPlugin<NaverWorksAccount> {
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
      media: true,
      threads: false,
      reactions: false,
      edit: false,
      unsend: false,
      reply: true,
      effects: false,
      blockStreaming: true,
    },

    streaming: {
      blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
    },

    reload: { configPrefixes: ["channels.naverworks", "bindings", "agents"] },

    configSchema: NaverWorksConfigSchema,

    config: {
      listAccountIds: (cfg: any) => listAccountIds(cfg),
      resolveAccount: (cfg: any, accountId?: string | null) => resolveAccount(cfg, accountId),
      defaultAccountId: () => DEFAULT_ACCOUNT_ID,
      isConfigured: (account: ReturnType<typeof resolveAccount>) => isNaverWorksConfigured(account),
      describeAccount: (account: ReturnType<typeof resolveAccount>) => ({
        accountId: account.accountId,
        enabled: account.enabled,
        configured: isNaverWorksConfigured(account),
        dmPolicy: account.dmPolicy,
      }),
      setAccountEnabled: ({ cfg, accountId, enabled }: any) =>
        setAccountEnabledInConfigSection({
          cfg,
          sectionKey: "channels.naverworks",
          accountId,
          enabled,
        }),
    },

    messaging: {
      normalizeTarget: (raw: string) => {
        const trimmed = raw?.trim();
        if (!trimmed) {
          return undefined;
        }
        return trimmed.replace(/^naverworks:/i, "");
      },
      targetResolver: {
        looksLikeId: (raw: string, normalized?: string | null) =>
          Boolean((normalized ?? raw)?.trim()),
        hint: "<userId>",
      },
    },

    outbound: {
      deliveryMode: "direct",
      sendText: async ({ cfg, to, text, accountId }: NaverWorksChannelOutboundContext) => {
        const account = resolveAccount(cfg as Record<string, unknown>, accountId);
        const sent = await sendMessageNaverWorks({
          account,
          toUserId: to,
          text,
        });
        if (!sent.ok) {
          if (sent.reason === "not-configured") {
            throw new Error(
              `NAVER WORKS account \"${account.accountId}\" is not configured for outbound delivery (set botId and auth settings).`,
            );
          }
          throw new Error(
            `NAVER WORKS send failed (${sent.reason}, status=${sent.status ?? "unknown"}): ${sent.body?.slice(0, 300) ?? ""}`,
          );
        }
        getNaverWorksRuntime().log?.info?.(
          `naverworks[${account.accountId}]: outbound sendText delivered to=${to} ${formatDeliveryLog(sent.delivery)}`,
        );
        return {
          channel: CHANNEL_ID,
          messageId: `naverworks:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
        };
      },
      sendMedia: async ({
        cfg,
        to,
        text,
        mediaUrl,
        accountId,
      }: NaverWorksChannelOutboundContext) => {
        const account = resolveAccount(cfg as Record<string, unknown>, accountId);
        const caption = text?.trim();
        const mediaHref = mediaUrl?.trim();
        if (caption) {
          const sentText = await sendMessageNaverWorks({
            account,
            toUserId: to,
            text: caption,
          });
          if (!sentText.ok) {
            throw new Error(
              `NAVER WORKS text preface failed (${sentText.reason}, status=${sentText.status ?? "unknown"}, to=${to}, mediaUrl=${mediaHref ?? "none"}): ${sentText.body?.slice(0, 300) ?? ""}`,
            );
          }
          getNaverWorksRuntime().log?.info?.(
            `naverworks[${account.accountId}]: outbound sendMedia text preface delivered to=${to} ${formatDeliveryLog(sentText.delivery)}`,
          );
        }
        const sentMedia = await sendMessageNaverWorks({
          account,
          toUserId: to,
          mediaUrl,
        });
        if (!sentMedia.ok) {
          if (sentMedia.reason === "not-configured") {
            throw new Error(
              `NAVER WORKS account \"${account.accountId}\" is not configured for media outbound delivery (set botId and auth settings).`,
            );
          }
          throw new Error(
            `NAVER WORKS media send failed (${sentMedia.reason}, status=${sentMedia.status ?? "unknown"}, to=${to}, mediaUrl=${mediaHref ?? "none"}): ${sentMedia.body?.slice(0, 300) ?? ""}`,
          );
        }
        getNaverWorksRuntime().log?.info?.(
          `naverworks[${account.accountId}]: outbound sendMedia delivered to=${to} ${formatDeliveryLog(sentMedia.delivery)}`,
        );
        return {
          channel: CHANNEL_ID,
          messageId: `naverworks:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
        };
      },
    },

    status: {
      defaultRuntime: {
        accountId: DEFAULT_ACCOUNT_ID,
        running: false,
        connected: false,
        lastStartAt: null,
        lastStopAt: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        lastError: null,
      },
      buildAccountSnapshot: ({ account, runtime }: any) => {
        const configured = isNaverWorksConfigured(account);
        return {
          accountId: account.accountId,
          enabled: account.enabled,
          configured,
          dmPolicy: account.dmPolicy,
          running: runtime?.running ?? false,
          connected: runtime?.connected ?? runtime?.running ?? false,
          lastStartAt: runtime?.lastStartAt ?? null,
          lastStopAt: runtime?.lastStopAt ?? null,
          lastInboundAt: runtime?.lastInboundAt ?? null,
          lastOutboundAt: runtime?.lastOutboundAt ?? null,
          lastError: runtime?.lastError ?? null,
        };
      },
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
            log?.info?.(`naverworks[${account.accountId}]: loading fresh config for inbound event`);
            const freshCfg = await runtime.config.loadConfig();
            log?.info?.(`naverworks[${account.accountId}]: config load complete`);
            log?.info?.(
              `naverworks[${account.accountId}]: resolving route for peer=${event.userId}${event.teamId ? ` teamId=${event.teamId}` : ""}`,
            );
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

            const debugCommand = parseNaverWorksDebugCommand(event.text);
            if (debugCommand) {
              await handleDebugCommand({
                account,
                userId: event.userId,
                command: debugCommand,
                log,
              });
              return;
            }

            const inboundBody =
              event.text?.trim() || (event.mediaKind ? `<media:${event.mediaKind}>` : "<media>");
            const autoThinkingDirective = resolveAutoThinkingDirective({
              text: event.text,
              account,
            });
            const bodyWithAutoThinking = autoThinkingDirective
              ? `${autoThinkingDirective}\n${inboundBody}`
              : inboundBody;
            log?.info?.(
              `naverworks[${account.accountId}]: preparing inbound context bodyType=${event.mediaKind ? "media" : "text"} mediaUrl=${event.mediaUrl ? "yes" : "no"} mediaFileId=${event.mediaFileId ? "yes" : "no"}`,
            );
            log?.info?.(
              `naverworks[${account.accountId}]: downloading inbound media=${event.mediaUrl || event.mediaFileId ? "yes" : "no"}`,
            );
            const downloadedMedia = await downloadNaverWorksInboundMedia({
              runtime,
              account,
              event,
              log,
            });
            log?.info?.(
              `naverworks[${account.accountId}]: inbound media download complete saved=${downloadedMedia.path ? "yes" : "no"} mediaType=${downloadedMedia.mediaType ?? "none"}`,
            );
            const mediaPath = downloadedMedia.path;
            const mediaUrls = event.mediaUrl ? [event.mediaUrl] : undefined;
            const mediaPaths = mediaPath ? [mediaPath] : undefined;
            const mediaTypes =
              downloadedMedia.mediaType || event.mediaMimeType || event.mediaKind
                ? [
                    downloadedMedia.mediaType ??
                      event.mediaMimeType ??
                      defaultInboundMediaType(event.mediaKind) ??
                      "application/octet-stream",
                  ]
                : undefined;

            const locationContext = event.location ? toLocationContext(event.location) : undefined;
            const msgCtx = {
              Body: bodyWithAutoThinking,
              BodyForAgent: bodyWithAutoThinking,
              RawBody: bodyWithAutoThinking,
              CommandBody: bodyWithAutoThinking,
              From: `naverworks:${event.userId}`,
              To: `naverworks:${account.accountId}`,
              SessionKey: route.sessionKey,
              AccountId: route.accountId,
              ChatType: "direct",
              SenderName: event.senderName,
              SenderId: event.userId,
              // Accepted NAVER WORKS DMs have already passed dmPolicy/allowlist checks,
              // so in-channel control commands like /new should be treated as authorized.
              CommandAuthorized: true,
              Provider: CHANNEL_ID,
              Surface: CHANNEL_ID,
              OriginatingChannel: CHANNEL_ID,
              OriginatingTo: `naverworks:${account.accountId}`,
              MediaPath: mediaPath,
              MediaPaths: mediaPaths,
              MediaType:
                downloadedMedia.mediaType ??
                event.mediaMimeType ??
                defaultInboundMediaType(event.mediaKind),
              MediaTypes: mediaTypes,
              MediaUrl: event.mediaUrl ?? mediaPath,
              MediaUrls: mediaUrls,
              MediaName: event.mediaFileName ?? event.mediaFileId,
              MediaFileId: event.mediaFileId,
              ...(locationContext ?? {}),
            };

            log?.info?.(
              `naverworks[${account.accountId}]: dispatching buffered reply sessionKey=${route.sessionKey}`,
            );
            let stopProgressMessageHeartbeat = async () => {};
            let progressMessageHeartbeatStarted = false;
            try {
              const dispatchResult =
                await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                  ctx: msgCtx,
                  cfg: freshCfg,
                  replyOptions: { sourceReplyDeliveryMode: "automatic" },
                  dispatcherOptions: {
                    onReplyStart: async () => {
                      log?.info?.(
                        `naverworks: reply started for ${event.userId} (${route.agentId})`,
                      );
                      if (progressMessageHeartbeatStarted) {
                        return;
                      }
                      progressMessageHeartbeatStarted = true;
                      stopProgressMessageHeartbeat = startProgressMessageHeartbeat({
                        account,
                        userId: event.userId,
                        log,
                      });
                    },
                    deliver: async (payload: {
                      text?: string;
                      body?: string;
                      mediaUrl?: string;
                      mediaUrls?: string[];
                      audioAsVoice?: boolean;
                    }) => {
                      const text = payload?.text ?? payload?.body;
                      const mediaUrls = resolveOutboundMediaUrls(payload ?? {});
                      const remoteMediaUrls = mediaUrls.filter((url) => /^https?:\/\//i.test(url));
                      const localMediaPaths = mediaUrls.filter((url) => !/^https?:\/\//i.test(url));
                      const pendingRemoteMedia = [...remoteMediaUrls];
                      let pendingText = text;
                      await stopProgressMessageHeartbeat();
                      log?.info?.(
                        `naverworks[${account.accountId}]: deliver callback text=${text ? "yes" : "no"} remoteMedia=${remoteMediaUrls.length} localMedia=${localMediaPaths.length}`,
                      );

                      if (localMediaPaths.length > 0) {
                        log?.warn?.(
                          `naverworks[${account.accountId}]: processing ${localMediaPaths.length} local media attachment(s) through NAVER WORKS attachment upload`,
                        );
                      }

                      log?.info?.(
                        `naverworks[${account.accountId}]: outbound routing pendingText=${pendingText ? "yes" : "no"} remoteMediaRemaining=${pendingRemoteMedia.length} localMediaRemaining=${localMediaPaths.length}`,
                      );
                      if (pendingText) {
                        log?.info?.(
                          `naverworks[${account.accountId}]: sending standalone text message to ${event.userId} textChars=${pendingText.length}`,
                        );
                        const sent = await sendMessageNaverWorks({
                          account,
                          toUserId: event.userId,
                          text: pendingText,
                        });

                        if (!sent.ok) {
                          if (sent.reason === "not-configured") {
                            log?.warn?.(
                              `naverworks[${account.accountId}]: outbound skipped (set botId and auth settings to enable delivery)`,
                            );
                            return;
                          }
                          if (sent.reason === "auth-error") {
                            log?.error?.(
                              `naverworks[${account.accountId}]: outbound auth failed status=${sent.status ?? "unknown"} body=${sent.body?.slice(0, 300) ?? ""} (check accessToken or JWT auth settings)`,
                            );
                            return;
                          }
                          log?.error?.(
                            `naverworks[${account.accountId}]: outbound send failed status=${sent.status ?? "unknown"} body=${sent.body?.slice(0, 300) ?? ""}`,
                          );
                          return;
                        }

                        log?.info?.(
                          `naverworks[${account.accountId}]: outbound text delivered to ${event.userId} ${formatDeliveryLog(sent.delivery)}`,
                        );
                      }

                      for (const mediaUrl of pendingRemoteMedia) {
                        log?.info?.(
                          `naverworks[${account.accountId}]: sending standalone remote media to ${event.userId} mediaUrl=${mediaUrl}`,
                        );
                        const sentMedia = await sendMessageNaverWorks({
                          account,
                          toUserId: event.userId,
                          mediaUrl,
                        });
                        if (!sentMedia.ok) {
                          if (sentMedia.reason === "not-configured") {
                            log?.warn?.(
                              `naverworks[${account.accountId}]: outbound media skipped (set botId and auth settings to enable delivery)`,
                            );
                            return;
                          }
                          if (sentMedia.reason === "auth-error") {
                            log?.error?.(
                              `naverworks[${account.accountId}]: outbound media auth failed status=${sentMedia.status ?? "unknown"} body=${sentMedia.body?.slice(0, 300) ?? ""}`,
                            );
                            return;
                          }
                          log?.error?.(
                            `naverworks[${account.accountId}]: outbound media send failed status=${sentMedia.status ?? "unknown"} body=${sentMedia.body?.slice(0, 300) ?? ""}`,
                          );
                          return;
                        }
                        log?.info?.(
                          `naverworks[${account.accountId}]: outbound media delivered to ${event.userId} ${formatDeliveryLog(sentMedia.delivery)}`,
                        );
                      }

                      for (const mediaPath of localMediaPaths) {
                        log?.info?.(
                          `naverworks[${account.accountId}]: sending local media through attachment upload to ${event.userId} mediaPath=${mediaPath}`,
                        );
                        const sentMedia = await sendMessageNaverWorks({
                          account,
                          toUserId: event.userId,
                          mediaUrl: mediaPath,
                        });
                        if (!sentMedia.ok) {
                          if (sentMedia.reason === "not-configured") {
                            log?.warn?.(
                              `naverworks[${account.accountId}]: outbound local media skipped (set botId and auth settings to enable delivery)`,
                            );
                            return;
                          }
                          if (sentMedia.reason === "auth-error") {
                            log?.error?.(
                              `naverworks[${account.accountId}]: outbound local media auth failed status=${sentMedia.status ?? "unknown"} body=${sentMedia.body?.slice(0, 300) ?? ""}`,
                            );
                            return;
                          }
                          log?.error?.(
                            `naverworks[${account.accountId}]: outbound local media send failed status=${sentMedia.status ?? "unknown"} body=${sentMedia.body?.slice(0, 300) ?? ""}`,
                          );
                          return;
                        }
                        log?.info?.(
                          `naverworks[${account.accountId}]: outbound local media delivered to ${event.userId} ${formatDeliveryLog(sentMedia.delivery)}`,
                        );
                      }
                    },
                  },
                });
              const debugDecision = resolveDebugSummaryDecision({
                account,
                userId: event.userId,
                consumeOnce: true,
              });
              const debugSummary = formatNaverWorksDebugSummary({
                account,
                enabled: debugDecision.enabled,
                usage: dispatchResult.replyUsage as NaverWorksReplyUsageSummary | undefined,
              });
              if (debugSummary) {
                try {
                  const sentDebug = await sendMessageNaverWorks({
                    account,
                    toUserId: event.userId,
                    text: debugSummary,
                  });
                  if (!sentDebug.ok) {
                    log?.warn?.(
                      `naverworks[${account.accountId}]: failed to send debug summary to ${event.userId} (reason=${sentDebug.reason}, status=${sentDebug.status ?? "unknown"}, body=${sentDebug.body?.slice(0, 300) ?? ""})`,
                    );
                  }
                } catch (error) {
                  log?.warn?.(
                    `naverworks[${account.accountId}]: debug summary send threw for ${event.userId}: ${String(error)}`,
                  );
                }
              }
              await stopProgressMessageHeartbeat();
            } catch (error) {
              await stopProgressMessageHeartbeat();
              const failedNoticeSent = await sendMessageNaverWorks({
                account,
                toUserId: event.userId,
                text: FAILED_REPLY_NOTICE,
              });
              if (!failedNoticeSent.ok) {
                log?.warn?.(
                  `naverworks[${account.accountId}]: failed to send failure notice to ${event.userId} (reason=${failedNoticeSent.reason}, status=${failedNoticeSent.status ?? "unknown"}, body=${failedNoticeSent.body?.slice(0, 300) ?? ""})`,
                );
              }
              log?.error?.(
                `naverworks[${account.accountId}]: reply pipeline failed for ${event.userId}: ${String(error)}`,
              );
              return;
            }
            log?.info?.(`naverworks[${account.accountId}]: buffered reply dispatch complete`);
            log?.info?.(
              `naverworks[${account.accountId}]: inbound event handled for ${event.userId} (agent=${route.agentId})`,
            );
          },
        });

        const unregister = registerPluginHttpRoute({
          path: account.webhookPath,
          auth: "plugin",
          pluginId: CHANNEL_ID,
          accountId: account.accountId,
          log: (line: string) => log?.info?.(line),
          handler,
        });
        log?.info?.(
          `naverworks[${account.accountId}]: webhook route registered at ${account.webhookPath}`,
        );
        activeRouteUnregisters.set(routeKey, unregister);
        ctx.setStatus({ connected: true, lastError: null });

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
          ctx.setStatus({ connected: false });
          unregister();
          activeRouteUnregisters.delete(routeKey);
        }
      },
      stopAccount: async () => {},
    },
  };
}

export const naverWorksPlugin = createNaverWorksPlugin();
