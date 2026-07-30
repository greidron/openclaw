import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { formatLocationText } from "openclaw/plugin-sdk/channel-inbound";
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

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function describeObjectShape(value: unknown): string {
  const object = asObject(value);
  const entries = Object.entries(object)
    .slice(0, 20)
    .map(([key, child]) => `${key}:${describeValueType(child)}`);
  return entries.length > 0 ? entries.join(",") : "-";
}

function describeObjectKeys(value: unknown): string {
  const keys = Object.keys(asObject(value)).slice(0, 30);
  return keys.length > 0 ? keys.join(",") : "-";
}

export function summarizeNaverWorksWebhookPayloadForLog(rawBody: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `json=parse_error error=${JSON.stringify(message)}`;
  }

  const root = asObject(parsed);
  const source = asObject(root.source);
  const user = asObject(root.user);
  const content = asObject(root.content);
  const message = asObject(root.message);
  const userId = pickFirstString([
    source.userId,
    source.user_id,
    user.userId,
    user.user_id,
    root.userId,
    root.user_id,
    root.senderId,
  ]);

  return [
    "json=ok",
    `rootType=${describeValueType(parsed)}`,
    `rootKeys=${describeObjectKeys(root)}`,
    `sourceKeys=${describeObjectKeys(source)}`,
    `userKeys=${describeObjectKeys(user)}`,
    `contentKeys=${describeObjectKeys(content)}`,
    `messageKeys=${describeObjectKeys(message)}`,
    `eventType=${JSON.stringify(asString(root.type) ?? "-")}`,
    `contentType=${JSON.stringify(asString(content.type) ?? asString(message.type) ?? "-")}`,
    `hasUserId=${userId ? "yes" : "no"}`,
    `hasContentFileId=${pickFirstString([content.fileId, content.resourceId, content.id]) ? "yes" : "no"}`,
    `sourceShape=${describeObjectShape(source)}`,
    `contentShape=${describeObjectShape(content)}`,
  ].join(" ");
}

function parseNaverWorksLocation(
  raw: Record<string, unknown>,
): NaverWorksInboundEvent["location"] | undefined {
  const content = asObject(raw.content);
  const message = asObject(raw.message);
  const resource = asObject(content.resource);
  const location = asObject(content.location);

  const latitudeRaw = pickFirstString([
    content.latitude,
    content.lat,
    content.y,
    location.latitude,
    location.lat,
    location.y,
    resource.latitude,
    resource.lat,
    resource.y,
    message.latitude,
    message.lat,
    raw.latitude,
    raw.lat,
  ]);
  const longitudeRaw = pickFirstString([
    content.longitude,
    content.lng,
    content.lon,
    content.x,
    location.longitude,
    location.lng,
    location.lon,
    location.x,
    resource.longitude,
    resource.lng,
    resource.lon,
    resource.x,
    message.longitude,
    message.lng,
    raw.longitude,
    raw.lng,
  ]);

  if (!latitudeRaw || !longitudeRaw) {
    return undefined;
  }

  const latitude = Number.parseFloat(latitudeRaw);
  const longitude = Number.parseFloat(longitudeRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }

  const accuracyRaw = pickFirstString([
    content.accuracy,
    content.accuracyMeters,
    location.accuracy,
    location.accuracyMeters,
    resource.accuracy,
    resource.accuracyMeters,
    raw.accuracy,
    raw.accuracyMeters,
  ]);
  const accuracy = accuracyRaw ? Number.parseFloat(accuracyRaw) : undefined;

  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) && (accuracy ?? 0) > 0 ? accuracy : undefined,
    name: pickFirstString([
      content.title,
      content.name,
      location.title,
      location.name,
      resource.title,
      resource.name,
      raw.title,
      raw.name,
    ]),
    address: pickFirstString([content.address, location.address, resource.address, raw.address]),
    isLive:
      typeof content.isLive === "boolean"
        ? content.isLive
        : typeof location.isLive === "boolean"
          ? location.isLive
          : typeof raw.isLive === "boolean"
            ? raw.isLive
            : pickFirstString([content.isLive, location.isLive, raw.isLive]) === "true",
  };
}

function parseMediaDurationMs(candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.round(candidate < 60 ? candidate * 1000 : candidate);
    }
    if (typeof candidate === "string") {
      const parsed = Number.parseFloat(candidate.trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        // Some payloads report duration in seconds. Normalize human-scale values to milliseconds.
        return Math.round(parsed < 60 ? parsed * 1000 : parsed);
      }
    }
  }
  return undefined;
}

function inferMediaKind(params: {
  contentType?: string;
  mimeType?: string;
  fileName?: string;
}): "image" | "audio" | "file" | undefined {
  const contentType = params.contentType?.toLowerCase();
  if (contentType) {
    if (contentType.includes("image") || contentType === "photo") {
      return "image";
    }
    if (contentType.includes("audio") || contentType.includes("voice")) {
      return "audio";
    }
    if (contentType.includes("video")) {
      return "file";
    }
    if (contentType !== "text") {
      return "file";
    }
  }

  const mimeType = params.mimeType?.toLowerCase();
  if (mimeType?.startsWith("image/")) {
    return "image";
  }
  if (mimeType?.startsWith("audio/")) {
    return "audio";
  }

  const fileName = params.fileName?.toLowerCase();
  if (fileName?.match(/\.(png|jpe?g|gif|webp|bmp|heic)$/)) {
    return "image";
  }
  if (fileName?.match(/\.(mp3|m4a|wav|ogg|opus|aac|flac|amr)$/)) {
    return "audio";
  }
  if (fileName?.match(/\.(mp4|mov|m4v|webm|avi|mkv)$/)) {
    return "file";
  }
  return undefined;
}

function resolveContentType(candidates: unknown[]): string | undefined {
  const contentType = pickFirstString(candidates)?.toLowerCase();
  return contentType || undefined;
}

function synthesizeNaverWorksText(params: {
  contentType?: string;
  content: Record<string, unknown>;
  message: Record<string, unknown>;
  root: Record<string, unknown>;
}): string | undefined {
  const contentType = params.contentType;
  if (!contentType) {
    return undefined;
  }

  if (["sticker", "emoji"].includes(contentType)) {
    const stickerId = pickFirstString([
      params.content.stickerId,
      params.content.emojiId,
      params.message.stickerId,
      params.root.stickerId,
    ]);
    return stickerId ? `🧩 Sticker (${stickerId})` : "🧩 Sticker";
  }

  if (["contact", "contacts", "vcard"].includes(contentType)) {
    const contact = asObject(params.content.contact);
    const profile = asObject(contact.profile);
    const phones = Array.isArray(contact.phones) ? contact.phones : [];
    const firstPhone = phones.length > 0 ? asObject(phones[0]) : {};
    const emails = Array.isArray(contact.emails) ? contact.emails : [];
    const firstEmail = emails.length > 0 ? asObject(emails[0]) : {};

    const name = pickFirstString([
      contact.name,
      profile.displayName,
      profile.name,
      params.content.name,
      params.message.name,
      params.root.name,
    ]);
    const phone = pickFirstString([
      contact.phoneNumber,
      firstPhone.value,
      firstPhone.phoneNumber,
      params.content.phoneNumber,
      params.root.phoneNumber,
    ]);
    const email = pickFirstString([
      contact.email,
      firstEmail.value,
      firstEmail.email,
      params.content.email,
      params.root.email,
    ]);
    const parts = [name, phone, email].filter(Boolean);
    return parts.length > 0 ? `👤 Contact: ${parts.join(" | ")}` : "👤 Contact shared";
  }

  if (["template", "postback", "button"].includes(contentType)) {
    const action = pickFirstString([
      params.content.action,
      params.content.label,
      params.message.action,
      params.root.action,
      params.root.postback,
    ]);
    return action ? `🧾 ${contentType}: ${action}` : `🧾 ${contentType}`;
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
  const location = parseNaverWorksLocation(root);
  const text = pickFirstString([content.text, message.text, root.text, root.body, root.message]);
  const contentType = resolveContentType([content.type, message.type, root.type]);
  const resource = asObject(content.resource);
  const file = asObject(content.file);
  const attachment = asObject(content.attachment);
  const media = asObject(content.media);

  const mediaFileId = pickFirstString([
    content.fileId,
    content.resourceId,
    content.id,
    resource.fileId,
    resource.resourceId,
    resource.id,
    file.fileId,
    file.resourceId,
    file.id,
    attachment.fileId,
    attachment.resourceId,
    attachment.id,
    media.fileId,
    media.resourceId,
    media.id,
    root.fileId,
    root.resourceId,
  ]);

  const mediaUrl = pickFirstString([
    content.resourceUrl,
    content.mediaUrl,
    content.downloadUrl,
    content.fileUrl,
    resource.url,
    resource.downloadUrl,
    resource.resourceUrl,
    file.url,
    file.downloadUrl,
    attachment.url,
    media.url,
    root.mediaUrl,
    root.fileUrl,
  ]);

  const mediaMimeType = pickFirstString([
    content.mimeType,
    content.contentType,
    content.mimetype,
    resource.mimeType,
    file.mimeType,
    attachment.mimeType,
    media.mimeType,
    root.mimeType,
  ]);

  const mediaFileName = pickFirstString([
    content.fileName,
    content.filename,
    resource.fileName,
    file.fileName,
    file.filename,
    attachment.fileName,
    root.fileName,
  ]);

  const mediaKind = inferMediaKind({
    contentType,
    mimeType: mediaMimeType,
    fileName: mediaFileName,
  });
  const synthesizedText =
    text ??
    (location ? formatLocationText(location) : undefined) ??
    synthesizeNaverWorksText({
      contentType,
      content,
      message,
      root,
    });

  if (!userId || (!synthesizedText && !mediaUrl && !mediaFileId && !location)) {
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
    text: synthesizedText,
    location,
    mediaUrl,
    mediaFileId,
    mediaKind,
    mediaMimeType,
    mediaFileName,
    mediaDurationMs: parseMediaDurationMs([
      content.durationMs,
      content.duration,
      resource.durationMs,
      resource.duration,
      file.durationMs,
      file.duration,
      media.durationMs,
      media.duration,
      root.durationMs,
      root.duration,
    ]),
    isDirect,
    senderName,
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
      log?.warn?.(
        `naverworks[${account.accountId}]: invalid webhook payload ${summarizeNaverWorksWebhookPayloadForLog(rawBody)}`,
      );
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
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      log?.error?.(`naverworks: async deliver failed: ${message}`);
      if (stack && stack !== message) {
        log?.error?.(stack);
      }
    }
  };
}
