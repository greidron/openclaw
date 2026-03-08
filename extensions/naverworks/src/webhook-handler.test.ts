import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseNaverWorksInbound, verifyNaverWorksSignature } from "./webhook-handler.js";

describe("parseNaverWorksInbound", () => {
  it("parses direct message payload with team + user ids", () => {
    const payload = JSON.stringify({
      source: {
        userId: "user-123",
        teamId: "team-a",
      },
      content: {
        text: "hello",
      },
      channel: {
        type: "direct",
      },
    });

    const parsed = parseNaverWorksInbound(payload);
    expect(parsed).toEqual(
      expect.objectContaining({
        userId: "user-123",
        teamId: "team-a",
        text: "hello",
        isDirect: true,
      }),
    );
  });

  it("parses numeric domainId as teamId string", () => {
    const payload = JSON.stringify({
      source: { userId: "u2", domainId: 12345 },
      content: { text: "hello" },
    });

    const parsed = parseNaverWorksInbound(payload);
    expect(parsed?.teamId).toBe("12345");
  });

  it("parses image-only payloads without text", () => {
    const payload = JSON.stringify({
      source: { userId: "u3", teamId: "team-a" },
      content: {
        type: "image",
        resourceUrl: "https://cdn.example.com/img-1.png",
        fileName: "img-1.png",
        mimeType: "image/png",
      },
      channel: { type: "direct" },
    });

    const parsed = parseNaverWorksInbound(payload);
    expect(parsed).toEqual(
      expect.objectContaining({
        userId: "u3",
        text: undefined,
        mediaKind: "image",
        mediaUrl: "https://cdn.example.com/img-1.png",
        mediaFileName: "img-1.png",
        mediaMimeType: "image/png",
        isDirect: true,
      }),
    );
  });

  it("parses voice payloads and normalizes duration", () => {
    const payload = JSON.stringify({
      source: { userId: "u4" },
      content: {
        type: "voice",
        file: {
          url: "https://cdn.example.com/voice-1.ogg",
          mimeType: "audio/ogg",
          duration: 4.2,
        },
      },
      channel: { type: "dm" },
    });

    const parsed = parseNaverWorksInbound(payload);
    expect(parsed).toEqual(
      expect.objectContaining({
        userId: "u4",
        text: undefined,
        mediaKind: "audio",
        mediaUrl: "https://cdn.example.com/voice-1.ogg",
        mediaMimeType: "audio/ogg",
        mediaDurationMs: 4200,
        isDirect: true,
      }),
    );
  });
  it("marks non-direct events so phase1 can ignore them", () => {
    const payload = JSON.stringify({
      source: { userId: "u1", domainId: "ws1" },
      message: { text: "in group" },
      channel: { type: "group" },
    });

    const parsed = parseNaverWorksInbound(payload);
    expect(parsed?.isDirect).toBe(false);
  });
});

describe("verifyNaverWorksSignature", () => {
  it("matches signature generated with HMAC-SHA256 + base64", () => {
    const body = JSON.stringify({ source: { userId: "u1" }, content: { text: "hello" } });
    const signature = crypto
      .createHmac("sha256", "bot-secret")
      .update(body, "utf-8")
      .digest("base64");

    expect(
      verifyNaverWorksSignature({
        body,
        botSecret: "bot-secret",
        headerSignature: signature,
      }),
    ).toBe(true);
  });

  it("returns false for missing or mismatched signatures", () => {
    const body = JSON.stringify({ source: { userId: "u1" }, content: { text: "hello" } });

    expect(
      verifyNaverWorksSignature({
        body,
        botSecret: "bot-secret",
      }),
    ).toBe(false);
    expect(
      verifyNaverWorksSignature({
        body,
        botSecret: "bot-secret",
        headerSignature: "invalid-signature",
      }),
    ).toBe(false);
  });
});
