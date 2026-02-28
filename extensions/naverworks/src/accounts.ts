import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { NaverWorksAccount } from "./types.js";

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
  };
}
