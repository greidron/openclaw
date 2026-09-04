export type NaverWorksStickerRef = {
  packageId: string;
  stickerId: string;
};

export type NaverWorksAccount = {
  accountId: string;
  enabled: boolean;
  webhookPath: string;
  dmPolicy: "open" | "pairing" | "allowlist" | "disabled";
  allowFrom: string[];
  botName: string;
  strictBinding: boolean;
  botSecret?: string;
  botId?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  serviceAccount?: string;
  privateKey?: string;
  scope?: string;
  tokenUrl: string;
  jwtIssuer?: string;
  apiBaseUrl: string;
  markdownMode: "plain" | "auto-flex";
  markdownTheme: "light" | "dark" | "auto";
  autoThinking?: {
    enabled: boolean;
    defaultLevel?: "low" | "medium" | "high";
    lowKeywords: string[];
    highKeywords: string[];
  };
  progressMessages?: {
    enabled: boolean;
    text: string;
    texts: string[];
    intervalMs: number;
    emojis: string[];
  };
  statusStickers?: {
    enabled: boolean;
    sticker: NaverWorksStickerRef;
  };
  runTimeoutSeconds?: number;
  progressEvents?: {
    blockReply: boolean;
    partialReply: boolean;
    reasoning: boolean;
    narration: boolean;
    item: boolean;
    toolStart: boolean;
    toolResult: boolean;
    commandOutput: boolean;
    planUpdate: boolean;
    approvalEvent: boolean;
  };
  debugSummary?: {
    enabled: boolean;
    includeCosts: boolean;
  };
  autoAttachImageLinks?: {
    enabled: boolean;
    maxImages: number;
  };
};

export type NaverWorksInboundEvent = {
  raw: Record<string, unknown>;
  userId: string;
  teamId?: string;
  text?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    name?: string;
    address?: string;
    isLive?: boolean;
  };
  mediaUrl?: string;
  mediaFileId?: string;
  mediaKind?: "image" | "audio" | "file";
  mediaMimeType?: string;
  mediaFileName?: string;
  mediaDurationMs?: number;
  isDirect: boolean;
  senderName?: string;
};
