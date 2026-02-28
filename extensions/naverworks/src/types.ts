export type NaverWorksAccount = {
  accountId: string;
  enabled: boolean;
  webhookPath: string;
  dmPolicy: "open" | "pairing" | "allowlist" | "disabled";
  allowFrom: string[];
  botName: string;
  strictBinding: boolean;
};

export type NaverWorksInboundEvent = {
  raw: Record<string, unknown>;
  userId: string;
  teamId?: string;
  text: string;
  isDirect: boolean;
  senderName?: string;
};
