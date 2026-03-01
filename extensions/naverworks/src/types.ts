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
};

export type NaverWorksInboundEvent = {
  raw: Record<string, unknown>;
  userId: string;
  teamId?: string;
  text: string;
  isDirect: boolean;
  senderName?: string;
};
