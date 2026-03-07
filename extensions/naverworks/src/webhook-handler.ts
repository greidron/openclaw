import crypto from "node:crypto";
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
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    const converted = String(value).trim();
    return converted || undefined;
  }
  return undefined;
}

function pickFirstString(candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return undefined;
}

function readSignatureHeader(req: IncomingMessage): string | undefined {
  const raw = req.headers["x-works-signature"];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      const normalized = asString(value);
      if (normalized) {
        return normalized;
      }
    }
    return undefined;
  }
  return asString(raw);
}

function buildExpectedSignature(params: { body: string; botSecret: string }): string {
  return crypto
    .createHmac("sha256", params.botSecret)
    .update(params.body, "utf-8")
    .digest("base64");
}

function signaturesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf-8");
  const rightBytes = Buffer.from(right, "utf-8");
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBytes, rightBytes);
}

export function verifyNaverWorksSignature(params: {
  body: string;
  botSecret: string;
  headerSignature?: string;
}): boolean {
  const normalizedHeader = asString(params.headerSignature);
  if (!normalizedHeader) {
    return false;
  }
  const expectedSignature = buildExpectedSignature({
    body: params.body,
    botSecret: params.botSecret,
  });
  return signaturesEqual(normalizedHeader, expectedSignature);
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

  const mediaTypeRaw = pickFirstString([content.type, message.type, root.type])?.toLowerCase();
  const mediaOriginalContentUrl = pickFirstString([
    content.originalContentUrl,
    content.original_content_url,
    message.originalContentUrl,
    message.original_content_url,
    root.originalContentUrl,
    root.original_content_url,
  ]);
  const mediaFileId = pickFirstString([content.fileId, message.fileId, root.fileId]);
  const media =
    mediaTypeRaw === "image" || mediaTypeRaw === "audio"
      ? {
          type: mediaTypeRaw,
          originalContentUrl: mediaOriginalContentUrl,
          fileId: mediaFileId,
        }
      : undefined;

  if (!userId || (!text && !media)) {
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

  const synthesizedText =
    text ??
    (media
      ? media.originalContentUrl
        ? `[naverworks:${media.type}] ${media.originalContentUrl}`
        : media.fileId
          ? `[naverworks:${media.type}] fileId:${media.fileId}`
          : `[naverworks:${media.type}]`
      : "");

  return {
    raw: root,
    userId,
    teamId,
    text: synthesizedText,
    isDirect,
    senderName,
    media,
  };
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

    if (account.botSecret) {
      const headerSignature = readSignatureHeader(req);
      if (
        !verifyNaverWorksSignature({ body: rawBody, botSecret: account.botSecret, headerSignature })
      ) {
        log?.warn?.(`naverworks[${account.accountId}]: webhook signature verification failed`);
        respondJson(res, 401, { error: "Invalid signature" });
        return;
      }
    }

    const event = parseNaverWorksInbound(rawBody);
    if (!event) {
      log?.warn?.(`naverworks[${account.accountId}]: invalid webhook payload`);
      respondJson(res, 400, { error: "Invalid NAVER WORKS event payload" });
      return;
    }

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
