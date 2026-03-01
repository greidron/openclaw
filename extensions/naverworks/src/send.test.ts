import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessageNaverWorks } from "./send.js";

describe("sendMessageNaverWorks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns not-configured when botId/accessToken are missing", async () => {
    const result = await sendMessageNaverWorks({
      account: {
        accountId: "default",
        enabled: true,
        webhookPath: "/naverworks/events",
        dmPolicy: "open",
        allowFrom: [],
        botName: "bot",
        strictBinding: true,
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
});
