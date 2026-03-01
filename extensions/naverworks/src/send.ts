import type { NaverWorksAccount } from "./types.js";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildSendUrl(account: NaverWorksAccount, userId: string): string {
  const base = trimTrailingSlash(account.apiBaseUrl);
  const encodedBotId = encodeURIComponent(account.botId ?? "");
  const encodedUserId = encodeURIComponent(userId);
  return `${base}/bots/${encodedBotId}/users/${encodedUserId}/messages`;
}

export async function sendMessageNaverWorks(params: {
  account: NaverWorksAccount;
  toUserId: string;
  text: string;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "not-configured" | "http-error"; status?: number; body?: string }
> {
  const { account, toUserId, text } = params;
  if (!account.botId || !account.accessToken) {
    return { ok: false, reason: "not-configured" };
  }

  const url = buildSendUrl(account, toUserId);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: { type: "text", text } }),
  });

  if (response.ok) {
    return { ok: true };
  }

  const body = await response.text().catch(() => "");
  return { ok: false, reason: "http-error", status: response.status, body };
}
