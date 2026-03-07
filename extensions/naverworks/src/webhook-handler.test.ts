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

  it("marks non-direct events so phase1 can ignore them", () => {
    const payload = JSON.stringify({
      source: { userId: "u1", domainId: "ws1" },
      message: { text: "in group" },
      channel: { type: "group" },
    });

    const parsed = parseNaverWorksInbound(payload);
    expect(parsed?.isDirect).toBe(false);
  });

  it("parses image payload and synthesizes text when text is missing", () => {
    const payload = JSON.stringify({
      source: { userId: "u-img" },
      content: {
        type: "image",
        originalContentUrl: "https://example.com/image.png",
      },
    });

    const parsed = parseNaverWorksInbound(payload);
    expect(parsed?.media).toEqual({
      type: "image",
      originalContentUrl: "https://example.com/image.png",
      fileId: undefined,
    });
    expect(parsed?.text).toBe("[naverworks:image] https://example.com/image.png");
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
