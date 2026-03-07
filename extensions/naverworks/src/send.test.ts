import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessageNaverWorks } from "./send.js";

describe("sendMessageNaverWorks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns not-configured when botId is missing", async () => {
    const result = await sendMessageNaverWorks({
      account: {
        accountId: "default",
        enabled: true,
        webhookPath: "/naverworks/events",
        dmPolicy: "open",
        allowFrom: [],
        botName: "bot",
        strictBinding: true,
        tokenUrl: "https://auth.worksmobile.com/oauth2/v2.0/token",
        apiBaseUrl: "https://www.worksapis.com/v1.0",
      },
      toUserId: "u1",
      text: "hello",
    });

    expect(result).toEqual({ ok: false, reason: "not-configured" });
  });

  it("posts to NAVER WORKS user message endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMessageNaverWorks({
      account: {
        accountId: "default",
        enabled: true,
        webhookPath: "/naverworks/events",
        dmPolicy: "open",
        allowFrom: [],
        botName: "bot",
        strictBinding: true,
        botId: "bot-1",
        accessToken: "token-1",
        tokenUrl: "https://auth.worksmobile.com/oauth2/v2.0/token",
        apiBaseUrl: "https://www.worksapis.com/v1.0",
      },
      toUserId: "user-1",
      text: "hello",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.worksapis.com/v1.0/bots/bot-1/users/user-1/messages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends image content when reply is markdown image", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMessageNaverWorks({
      account: {
        accountId: "default",
        enabled: true,
        webhookPath: "/naverworks/events",
        dmPolicy: "open",
        allowFrom: [],
        botName: "bot",
        strictBinding: true,
        botId: "bot-1",
        accessToken: "token-1",
        tokenUrl: "https://auth.worksmobile.com/oauth2/v2.0/token",
        apiBaseUrl: "https://www.worksapis.com/v1.0",
      },
      toUserId: "user-1",
      text: "![photo](https://example.com/photo.png)",
    });

    expect(result).toEqual({ ok: true });
    const request = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
    expect(request?.body).toContain('"type":"image"');
    expect(request?.body).toContain('"originalContentUrl":"https://example.com/photo.png"');
  });

  it("sends audio content when reply is [audio](url)", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMessageNaverWorks({
      account: {
        accountId: "default",
        enabled: true,
        webhookPath: "/naverworks/events",
        dmPolicy: "open",
        allowFrom: [],
        botName: "bot",
        strictBinding: true,
        botId: "bot-1",
        accessToken: "token-1",
        tokenUrl: "https://auth.worksmobile.com/oauth2/v2.0/token",
        apiBaseUrl: "https://www.worksapis.com/v1.0",
      },
      toUserId: "user-1",
      text: "[audio](https://example.com/sample.mp3)",
    });

    expect(result).toEqual({ ok: true });
    const request = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
    expect(request?.body).toContain('"type":"audio"');
    expect(request?.body).toContain('"originalContentUrl":"https://example.com/sample.mp3"');
  });
  it("issues oauth token with JWT auth when accessToken is omitted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "issued-token", expires_in: 86400 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const generatedPrivateKey = crypto
      .generateKeyPairSync("rsa", {
        modulusLength: 2048,
      })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();

    const result = await sendMessageNaverWorks({
      account: {
        accountId: "retry",
        enabled: true,
        webhookPath: "/naverworks/events",
        dmPolicy: "open",
        allowFrom: [],
        botName: "bot",
        strictBinding: true,
        botId: "bot-1",
        clientId: "client-retry-2",
        clientSecret: "secret-retry-2",
        serviceAccount: "svc-retry-2@example.com",
        privateKey: generatedPrivateKey,
        scope: "bot",
        tokenUrl: "https://auth.worksmobile.com/oauth2/v2.0/token",
        apiBaseUrl: "https://www.worksapis.com/v1.0",
        jwtIssuer: "issuer-1",
      },
      toUserId: "user-1",
      text: "hello",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://auth.worksmobile.com/oauth2/v2.0/token",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          toString: expect.any(Function),
        }),
      }),
    );
    const firstTokenCall = fetchMock.mock.calls[0]?.[1] as { body?: URLSearchParams } | undefined;
    expect(firstTokenCall?.body?.toString()).toContain("client_secret=secret-retry-2");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://www.worksapis.com/v1.0/bots/bot-1/users/user-1/messages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("retries once with refreshed jwt token on auth failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "issued-token-1", expires_in: 3600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "issued-token-2", expires_in: 3600 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const generatedPrivateKey = crypto
      .generateKeyPairSync("rsa", {
        modulusLength: 2048,
      })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();

    const result = await sendMessageNaverWorks({
      account: {
        accountId: "default",
        enabled: true,
        webhookPath: "/naverworks/events",
        dmPolicy: "open",
        allowFrom: [],
        botName: "bot",
        strictBinding: true,
        botId: "bot-1",
        clientId: "client-retry",
        clientSecret: "secret-retry",
        serviceAccount: "svc-retry@example.com",
        privateKey: generatedPrivateKey,
        scope: "bot",
        tokenUrl: "https://auth.worksmobile.com/oauth2/v2.0/token",
        apiBaseUrl: "https://www.worksapis.com/v1.0",
        jwtIssuer: "issuer-1",
      },
      toUserId: "user-1",
      text: "hello",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://auth.worksmobile.com/oauth2/v2.0/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://auth.worksmobile.com/oauth2/v2.0/token",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("returns auth-error details when JWT token endpoint fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("invalid_client", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const generatedPrivateKey = crypto
      .generateKeyPairSync("rsa", {
        modulusLength: 2048,
      })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();

    const result = await sendMessageNaverWorks({
      account: {
        accountId: "auth-fail",
        enabled: true,
        webhookPath: "/naverworks/events",
        dmPolicy: "open",
        allowFrom: [],
        botName: "bot",
        strictBinding: true,
        botId: "bot-1",
        clientId: "client-auth-fail",
        clientSecret: "secret-auth-fail",
        serviceAccount: "svc-auth-fail@example.com",
        privateKey: generatedPrivateKey,
        scope: "bot",
        tokenUrl: "https://auth.worksmobile.com/oauth2/v2.0/token",
        apiBaseUrl: "https://www.worksapis.com/v1.0",
        jwtIssuer: "issuer-auth-fail",
      },
      toUserId: "user-1",
      text: "hello",
    });

    expect(result).toEqual({
      ok: false,
      reason: "auth-error",
      status: 401,
      body: "invalid_client",
    });
  });
});
