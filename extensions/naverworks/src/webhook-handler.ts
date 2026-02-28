import type { IncomingMessage, ServerResponse } from "node:http";
import type { NaverWorksAccount, NaverWorksInboundEvent } from "./types.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxSize = 2 * 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function pickFirstString(candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return undefined;
}

export function parseNaverWorksInbound(rawBody: string): NaverWorksInboundEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const root = asObject(parsed);
  const source = asObject(root.source);
  const user = asObject(root.user);
  const content = asObject(root.content);
  const message = asObject(root.message);
  const channel = asObject(root.channel);
  const conversation = asObject(root.conversation);

  const userId = pickFirstString([
    source.userId,
    source.user_id,
    user.userId,
    user.user_id,
    root.userId,
    root.user_id,
    root.senderId,
  ]);
  const text = pickFirstString([content.text, message.text, root.text, root.body, root.message]);

  if (!userId || !text) {
    return null;
  }

  const teamId = pickFirstString([
    source.teamId,
    source.domainId,
    source.tenantId,
    root.teamId,
    root.domainId,
    root.tenantId,
  ]);

  const chatTypeRaw = pickFirstString([
    channel.type,
    conversation.type,
    root.channelType,
    root.chatType,
  ])?.toLowerCase();

  const isDirect = !chatTypeRaw || ["direct", "dm", "1:1", "one_to_one"].includes(chatTypeRaw);

  const senderName = pickFirstString([
    user.name,
    source.userName,
    source.username,
    root.senderName,
  ]);

  return {
    raw: root,
    userId,
    teamId,
    text,
    isDirect,
    senderName,
  };
}

function previewPayload(payload: string, maxLen = 1000): string {
  const compact = payload.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) {
    return compact;
  }
  return `${compact.slice(0, maxLen)}...`;
}

function respondJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export type NaverWorksWebhookDeps = {
  account: NaverWorksAccount;
  deliver: (event: NaverWorksInboundEvent) => Promise<void>;
  log?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
};

export function createNaverWorksWebhookHandler(deps: NaverWorksWebhookDeps) {
  const { account, deliver, log } = deps;
  return async (req: IncomingMessage, res: ServerResponse) => {
    log?.info?.(
      `naverworks[${account.accountId}]: webhook request received (${req.method ?? "UNKNOWN"})`,
    );
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    let rawBody = "";
    try {
      rawBody = await readBody(req);
    } catch (error) {
      log?.error?.("naverworks: failed reading request body", error);
      respondJson(res, 400, { error: "Invalid body" });
      return;
    }

    log?.info?.(
      `naverworks[${account.accountId}]: webhook payload bytes=${rawBody.length} preview=${previewPayload(rawBody)}`,
    );

    const event = parseNaverWorksInbound(rawBody);
    if (!event) {
      log?.warn?.(
        `naverworks[${account.accountId}]: invalid webhook payload preview=${previewPayload(rawBody)}`,
      );
      respondJson(res, 400, { error: "Invalid NAVER WORKS event payload" });
      return;
    }

    log?.info?.(
      `naverworks[${account.accountId}]: parsed event userId=${event.userId}${event.teamId ? ` teamId=${event.teamId}` : ""} isDirect=${event.isDirect}`,
    );

    if (!event.isDirect) {
      // Phase 1 requirement: DM only.
      log?.info?.(
        `naverworks[${account.accountId}]: ignored non-direct event from ${event.userId}${event.teamId ? ` teamId=${event.teamId}` : ""}`,
      );
      respondJson(res, 200, { ok: true, ignored: "non-direct" });
      return;
    }

    if (account.dmPolicy === "disabled") {
      log?.warn?.(`naverworks[${account.accountId}]: DM blocked by dmPolicy=disabled`);
      respondJson(res, 403, { error: "DM disabled" });
      return;
    }

    if (account.dmPolicy === "allowlist" && account.allowFrom.length > 0) {
      if (!account.allowFrom.includes(event.userId)) {
        log?.warn?.(
          `naverworks[${account.accountId}]: sender blocked by allowlist (${event.userId}${event.teamId ? ` teamId=${event.teamId}` : ""})`,
        );
        respondJson(res, 403, { error: "Sender not in allowlist" });
        return;
      }
    }

    log?.info?.(
      `naverworks[${account.accountId}]: accepted direct event from ${event.userId}${event.teamId ? ` teamId=${event.teamId}` : ""}; scheduling async delivery`,
    );
    respondJson(res, 200, { ok: true });

    try {
      await deliver(event);
    } catch (error) {
      log?.error?.("naverworks: async deliver failed", error);
    }
  };
}
