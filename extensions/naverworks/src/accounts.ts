import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/routing";
import type { NaverWorksAccount } from "./types.js";

const DEFAULT_PROGRESS_MESSAGES: Required<NonNullable<NaverWorksAccount["progressMessages"]>> = {
  enabled: true,
  text: "생각 중입니다...",
  texts: [
    "생각 중입니다...",
    "답변을 준비하고 있어요...",
    "잠시만요, 확인 중입니다...",
    "자료를 살펴보는 중입니다...",
    "정리해서 답변드릴게요...",
    "내용을 확인하고 있어요...",
    "답변 방향을 잡고 있어요...",
    "필요한 내용을 찾는 중입니다...",
  ],
  intervalMs: 60_000,
  emojis: ["🤔", "🔎", "🧠", "✍️", "💬", "✨", "📚", "🕒"],
};

const DEFAULT_DEBUG_SUMMARY: Required<NonNullable<NaverWorksAccount["debugSummary"]>> = {
  enabled: false,
  includeCosts: true,
};

const DEFAULT_STATUS_STICKERS: Required<NonNullable<NaverWorksAccount["statusStickers"]>> = {
  enabled: true,
  sticker: {
    packageId: "789",
    stickerId: "10855",
  },
};

const DEFAULT_PROGRESS_EVENTS: Required<NonNullable<NaverWorksAccount["progressEvents"]>> = {
  blockReply: false,
  partialReply: false,
  reasoning: true,
  narration: false,
  item: false,
  toolStart: false,
  toolResult: false,
  commandOutput: false,
  planUpdate: false,
  approvalEvent: false,
};

const DEFAULT_RUN_TIMEOUT_SECONDS = 30 * 60;

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
    .filter((entry) => entry.length > 0);
}

function asThinkingLevel(value: unknown): "low" | "medium" | "high" | undefined {
  const level = asString(value)?.toLowerCase();
  if (level === "low" || level === "medium" || level === "high") {
    return level;
  }
  return undefined;
}

function normalizePrivateKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/\\n/g, "\n");
}

function asPositiveInteger(value: unknown): number | undefined {
  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    return undefined;
  }
  return candidate;
}

function asNonNegativeInteger(value: unknown): number | undefined {
  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    return undefined;
  }
  return candidate;
}

export function listAccountIds(cfg: Record<string, unknown>): string[] {
  const section = ((cfg as any)?.channels?.naverworks ?? {}) as Record<string, unknown>;
  const accounts = (section.accounts ?? {}) as Record<string, unknown>;
  const ids = Object.keys(accounts);
  return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}

export function resolveAccount(
  cfg: Record<string, unknown>,
  accountId?: string | null,
): NaverWorksAccount {
  const resolvedId = (accountId ?? DEFAULT_ACCOUNT_ID).trim() || DEFAULT_ACCOUNT_ID;
  const section = ((cfg as any)?.channels?.naverworks ?? {}) as Record<string, unknown>;
  const accounts = (section.accounts ?? {}) as Record<string, unknown>;
  const accountCfg = (accounts[resolvedId] ?? {}) as Record<string, unknown>;
  const sectionAutoThinking = (section.autoThinking ?? {}) as Record<string, unknown>;
  const accountAutoThinking = (accountCfg.autoThinking ?? {}) as Record<string, unknown>;
  const sectionProgressMessages = (section.progressMessages ?? {}) as Record<string, unknown>;
  const accountProgressMessages = (accountCfg.progressMessages ?? {}) as Record<string, unknown>;
  const sectionStatusStickers = (section.statusStickers ?? {}) as Record<string, unknown>;
  const accountStatusStickers = (accountCfg.statusStickers ?? {}) as Record<string, unknown>;
  const sectionStatusSticker = (sectionStatusStickers.sticker ?? {}) as Record<string, unknown>;
  const accountStatusSticker = (accountStatusStickers.sticker ?? {}) as Record<string, unknown>;
  const sectionDebugSummary = (section.debugSummary ?? {}) as Record<string, unknown>;
  const accountDebugSummary = (accountCfg.debugSummary ?? {}) as Record<string, unknown>;
  const sectionProgressEvents = (section.progressEvents ?? {}) as Record<string, unknown>;
  const accountProgressEvents = (accountCfg.progressEvents ?? {}) as Record<string, unknown>;
  const progressMessageEmojis = [
    ...asStringList(sectionProgressMessages.emojis),
    ...asStringList(accountProgressMessages.emojis),
  ];
  const progressMessageTexts = [
    ...asStringList(sectionProgressMessages.texts),
    ...asStringList(accountProgressMessages.texts),
  ];
  const accountProgressMessageText = asString(accountProgressMessages.text);
  const sectionProgressMessageText = asString(sectionProgressMessages.text);
  const progressMessageText =
    accountProgressMessageText ?? sectionProgressMessageText ?? DEFAULT_PROGRESS_MESSAGES.text;
  const progressMessageTextConfigured =
    accountProgressMessageText !== undefined || sectionProgressMessageText !== undefined;

  const dmPolicy =
    (asString(accountCfg.dmPolicy) as NaverWorksAccount["dmPolicy"] | undefined) ??
    (asString(section.dmPolicy) as NaverWorksAccount["dmPolicy"] | undefined) ??
    "pairing";

  return {
    accountId: resolvedId,
    enabled:
      (accountCfg.enabled as boolean | undefined) ??
      (section.enabled as boolean | undefined) ??
      true,
    webhookPath:
      asString(accountCfg.webhookPath) ??
      asString(section.webhookPath) ??
      `/naverworks/${resolvedId}/events`,
    dmPolicy,
    allowFrom: [...asStringList(section.allowFrom), ...asStringList(accountCfg.allowFrom)],
    botName: asString(accountCfg.botName) ?? asString(section.botName) ?? "NAVER WORKS Bot",
    strictBinding:
      (accountCfg.strictBinding as boolean | undefined) ??
      (section.strictBinding as boolean | undefined) ??
      true,
    botSecret: asString(accountCfg.botSecret) ?? asString(section.botSecret),
    botId: asString(accountCfg.botId) ?? asString(section.botId),
    accessToken: asString(accountCfg.accessToken) ?? asString(section.accessToken),
    clientId: asString(accountCfg.clientId) ?? asString(section.clientId),
    clientSecret: asString(accountCfg.clientSecret) ?? asString(section.clientSecret),
    serviceAccount: asString(accountCfg.serviceAccount) ?? asString(section.serviceAccount),
    privateKey: normalizePrivateKey(
      asString(accountCfg.privateKey) ?? asString(section.privateKey),
    ),
    scope: asString(accountCfg.scope) ?? asString(section.scope) ?? "bot",
    tokenUrl:
      asString(accountCfg.tokenUrl) ??
      asString(section.tokenUrl) ??
      "https://auth.worksmobile.com/oauth2/v2.0/token",
    jwtIssuer:
      asString(accountCfg.jwtIssuer) ?? asString(section.jwtIssuer) ?? asString(section.clientId),
    apiBaseUrl:
      asString(accountCfg.apiBaseUrl) ??
      asString(section.apiBaseUrl) ??
      "https://www.worksapis.com/v1.0",
    markdownMode:
      (asString(accountCfg.markdownMode) as NaverWorksAccount["markdownMode"] | undefined) ??
      (asString(section.markdownMode) as NaverWorksAccount["markdownMode"] | undefined) ??
      "auto-flex",
    markdownTheme:
      (asString(accountCfg.markdownTheme) as NaverWorksAccount["markdownTheme"] | undefined) ??
      (asString(section.markdownTheme) as NaverWorksAccount["markdownTheme"] | undefined) ??
      "auto",
    autoThinking: {
      enabled:
        (accountAutoThinking.enabled as boolean | undefined) ??
        (sectionAutoThinking.enabled as boolean | undefined) ??
        false,
      defaultLevel:
        asThinkingLevel(accountAutoThinking.defaultLevel) ??
        asThinkingLevel(sectionAutoThinking.defaultLevel),
      lowKeywords: [
        ...asStringList(sectionAutoThinking.lowKeywords),
        ...asStringList(accountAutoThinking.lowKeywords),
      ],
      highKeywords: [
        ...asStringList(sectionAutoThinking.highKeywords),
        ...asStringList(accountAutoThinking.highKeywords),
      ],
    },
    progressMessages: {
      enabled:
        (accountProgressMessages.enabled as boolean | undefined) ??
        (sectionProgressMessages.enabled as boolean | undefined) ??
        DEFAULT_PROGRESS_MESSAGES.enabled,
      text: progressMessageText,
      texts:
        progressMessageTexts.length > 0
          ? progressMessageTexts
          : progressMessageTextConfigured
            ? [progressMessageText]
            : DEFAULT_PROGRESS_MESSAGES.texts,
      intervalMs:
        asPositiveInteger(accountProgressMessages.intervalMs) ??
        asPositiveInteger(sectionProgressMessages.intervalMs) ??
        DEFAULT_PROGRESS_MESSAGES.intervalMs,
      emojis:
        progressMessageEmojis.length > 0 ? progressMessageEmojis : DEFAULT_PROGRESS_MESSAGES.emojis,
    },
    statusStickers: {
      enabled:
        (accountStatusStickers.enabled as boolean | undefined) ??
        (sectionStatusStickers.enabled as boolean | undefined) ??
        DEFAULT_STATUS_STICKERS.enabled,
      sticker: {
        packageId:
          asString(accountStatusSticker.packageId) ??
          asString(sectionStatusSticker.packageId) ??
          DEFAULT_STATUS_STICKERS.sticker.packageId,
        stickerId:
          asString(accountStatusSticker.stickerId) ??
          asString(sectionStatusSticker.stickerId) ??
          DEFAULT_STATUS_STICKERS.sticker.stickerId,
      },
    },
    runTimeoutSeconds:
      asNonNegativeInteger(accountCfg.runTimeoutSeconds) ??
      asNonNegativeInteger(section.runTimeoutSeconds) ??
      DEFAULT_RUN_TIMEOUT_SECONDS,
    progressEvents: {
      blockReply:
        (accountProgressEvents.blockReply as boolean | undefined) ??
        (sectionProgressEvents.blockReply as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.blockReply,
      partialReply:
        (accountProgressEvents.partialReply as boolean | undefined) ??
        (sectionProgressEvents.partialReply as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.partialReply,
      reasoning:
        (accountProgressEvents.reasoning as boolean | undefined) ??
        (sectionProgressEvents.reasoning as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.reasoning,
      narration:
        (accountProgressEvents.narration as boolean | undefined) ??
        (sectionProgressEvents.narration as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.narration,
      item:
        (accountProgressEvents.item as boolean | undefined) ??
        (sectionProgressEvents.item as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.item,
      toolStart:
        (accountProgressEvents.toolStart as boolean | undefined) ??
        (sectionProgressEvents.toolStart as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.toolStart,
      toolResult:
        (accountProgressEvents.toolResult as boolean | undefined) ??
        (sectionProgressEvents.toolResult as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.toolResult,
      commandOutput:
        (accountProgressEvents.commandOutput as boolean | undefined) ??
        (sectionProgressEvents.commandOutput as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.commandOutput,
      planUpdate:
        (accountProgressEvents.planUpdate as boolean | undefined) ??
        (sectionProgressEvents.planUpdate as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.planUpdate,
      approvalEvent:
        (accountProgressEvents.approvalEvent as boolean | undefined) ??
        (sectionProgressEvents.approvalEvent as boolean | undefined) ??
        DEFAULT_PROGRESS_EVENTS.approvalEvent,
    },
    debugSummary: {
      enabled:
        (accountDebugSummary.enabled as boolean | undefined) ??
        (sectionDebugSummary.enabled as boolean | undefined) ??
        DEFAULT_DEBUG_SUMMARY.enabled,
      includeCosts:
        (accountDebugSummary.includeCosts as boolean | undefined) ??
        (sectionDebugSummary.includeCosts as boolean | undefined) ??
        DEFAULT_DEBUG_SUMMARY.includeCosts,
    },
  };
}
