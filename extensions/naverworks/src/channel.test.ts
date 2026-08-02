import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAccount } from "./accounts.js";
import {
  createNaverWorksPlugin,
  downloadNaverWorksInboundMedia,
  parseNaverWorksDebugCommand,
  resolveNaverWorksHeartbeatProgressTextForTest,
  resolveAutoThinkingDirective,
  resolveNaverWorksProgressEventTextForTest,
  resolveNaverWorksPartialReplyProgressText,
  resolveNaverWorksAttachmentDownloadUrl,
} from "./channel.js";
import { setNaverWorksRuntime } from "./runtime.js";

describe("naverworks channel plugin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks account configured when botId + auth are present", async () => {
    const plugin = createNaverWorksPlugin();
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            botId: "bot-1",
            accessToken: "token-1",
          },
        },
      },
      "default",
    );

    expect(plugin.config.isConfigured?.(account as never, {} as never)).toBe(true);
  });

  it("enables block streaming with bounded coalescing", () => {
    const plugin = createNaverWorksPlugin();

    expect(plugin.capabilities.blockStreaming).toBe(true);
    expect(plugin.streaming?.blockStreamingCoalesceDefaults).toEqual({
      minChars: 1500,
      idleMs: 1000,
    });
  });

  it("parses NAVER WORKS debug control commands before agent dispatch", () => {
    expect(parseNaverWorksDebugCommand("/debug")).toEqual({ kind: "status" });
    expect(parseNaverWorksDebugCommand("/debug status")).toEqual({ kind: "status" });
    expect(parseNaverWorksDebugCommand("/debug on")).toEqual({ kind: "on" });
    expect(parseNaverWorksDebugCommand("/debug off")).toEqual({ kind: "off" });
    expect(parseNaverWorksDebugCommand("/debug once")).toEqual({ kind: "once" });
    expect(parseNaverWorksDebugCommand("debug on")).toBeUndefined();
    expect(parseNaverWorksDebugCommand("/debug later")).toEqual({ kind: "status" });
  });

  it("marks account unconfigured when outbound auth is missing", async () => {
    const plugin = createNaverWorksPlugin();
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            botId: "bot-1",
          },
        },
      },
      "default",
    );

    expect(plugin.config.isConfigured?.(account as never, {} as never)).toBe(false);
  });

  it("reports not-configured from outbound sendText", async () => {
    const plugin = createNaverWorksPlugin();
    if (!plugin.outbound?.sendText) {
      throw new Error("outbound.sendText missing");
    }

    await expect(
      plugin.outbound.sendText({
        cfg: { channels: { naverworks: {} } } as never,
        to: "user-1",
        text: "hello",
      }),
    ).rejects.toThrow(/not configured for outbound delivery/i);
  });

  it("sends text and image as separate messages from outbound sendMedia", async () => {
    const plugin = createNaverWorksPlugin();
    if (!plugin.outbound?.sendMedia) {
      throw new Error("outbound.sendMedia missing");
    }

    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setNaverWorksRuntime({ log: { info: vi.fn() } } as never);

    await plugin.outbound.sendMedia({
      cfg: {
        channels: {
          naverworks: {
            botId: "bot-1",
            accessToken: "token-1",
          },
        },
      } as never,
      to: "user-1",
      text: "caption",
      mediaUrl: "https://example.com/photo.png",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      String((fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined)?.body ?? ""),
    ).toContain('"type":"text"');
    expect(
      String((fetchMock.mock.calls[1]?.[1] as { body?: string } | undefined)?.body ?? ""),
    ).toContain('"type":"image"');
  });

  it("resolves NAVER WORKS attachment fileId through the authenticated redirect", async () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            botId: "bot-1",
            accessToken: "token-1",
          },
        },
      },
      "default",
    );
    const fetchMock = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: {
            Location: "https://apis-storage.worksmobile.com/download/file-1",
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveNaverWorksAttachmentDownloadUrl({
        account,
        fileId: "file/with=safe-encoding",
        headers: { Authorization: "Bearer token-1" },
      }),
    ).resolves.toBe("https://apis-storage.worksmobile.com/download/file-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.worksapis.com/v1.0/bots/bot-1/attachments/file%2Fwith%3Dsafe-encoding",
      expect.objectContaining({
        redirect: "manual",
        headers: { Authorization: "Bearer token-1" },
      }),
    );
  });

  it("downloads NAVER WORKS fileId media through the authenticated storage URL", async () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            botId: "bot-1",
            accessToken: "token-1",
          },
        },
      },
      "default",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("", {
            status: 302,
            headers: {
              Location: "https://apis-storage.worksmobile.com/download/file-1",
            },
          }),
      ),
    );
    const fetchRemoteMedia = vi.fn(async () => ({
      buffer: Buffer.from("image"),
      contentType: "image/png",
      fileName: "photo.png",
    }));
    const saveMediaBuffer = vi.fn(async () => ({
      path: "/tmp/openclaw-naverworks/photo.png",
      contentType: "image/png",
    }));

    await expect(
      downloadNaverWorksInboundMedia({
        runtime: {
          channel: {
            media: {
              fetchRemoteMedia,
              saveMediaBuffer,
            },
          },
        } as never,
        account,
        event: {
          mediaFileId: "file-1",
          mediaKind: "image",
        },
      }),
    ).resolves.toEqual({
      path: "/tmp/openclaw-naverworks/photo.png",
      mediaType: "image/png",
    });

    expect(fetchRemoteMedia).toHaveBeenCalledWith({
      url: "https://apis-storage.worksmobile.com/download/file-1",
      maxBytes: 20 * 1024 * 1024,
      requestInit: { headers: { Authorization: "Bearer token-1" } },
    });
    expect(saveMediaBuffer).toHaveBeenCalledWith(
      Buffer.from("image"),
      "image/png",
      "inbound",
      20 * 1024 * 1024,
      "photo.png",
    );
  });

  it("resolves auto thinking directive from keyword rules", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            autoThinking: {
              enabled: true,
              defaultLevel: "medium",
              lowKeywords: ["요약"],
              highKeywords: ["분석", "비교"],
            },
          },
        },
      },
      "default",
    );

    expect(resolveAutoThinkingDirective({ text: "이 로그 좀 분석해줘", account })).toBe(
      "/think high",
    );
    expect(resolveAutoThinkingDirective({ text: "긴 문서를 요약해줘", account })).toBe(
      "/think low",
    );
    expect(resolveAutoThinkingDirective({ text: "안녕", account })).toBe("/think medium");
  });

  it("does not auto-inject when user already sent a think directive", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            autoThinking: {
              enabled: true,
              defaultLevel: "high",
            },
          },
        },
      },
      "default",
    );

    expect(
      resolveAutoThinkingDirective({ text: "/think low 그리고 답변해줘", account }),
    ).toBeUndefined();
  });

  it("projects assistant partial replies into incremental NAVER WORKS progress text", () => {
    const first = resolveNaverWorksPartialReplyProgressText(
      { text: "기록 레코드를 만들겠습니다." },
      "",
    );
    expect(first).toEqual({
      text: "기록 레코드를 만들겠습니다.",
      nextText: "기록 레코드를 만들겠습니다.",
    });

    const second = resolveNaverWorksPartialReplyProgressText(
      { text: "기록 레코드를 만들겠습니다. 카드번호는 비워두겠습니다." },
      first.nextText,
    );
    expect(second).toEqual({
      text: "카드번호는 비워두겠습니다.",
      nextText: "기록 레코드를 만들겠습니다. 카드번호는 비워두겠습니다.",
    });

    expect(
      resolveNaverWorksPartialReplyProgressText({ delta: " 다음 단계입니다." }, second.nextText),
    ).toEqual({
      text: "다음 단계입니다.",
      nextText: "기록 레코드를 만들겠습니다. 카드번호는 비워두겠습니다. 다음 단계입니다.",
    });
  });

  it("formats web UI-style progress events for NAVER WORKS timeline messages", () => {
    expect(
      resolveNaverWorksProgressEventTextForTest({
        kind: "tool-start",
        payload: { name: "openclaw cron run", phase: "started" },
      }),
    ).toBe("🛠️ openclaw cron run 실행 중 (started)");
    expect(
      resolveNaverWorksProgressEventTextForTest({
        kind: "tool-result",
        payload: { text: "수동 실행이 진행 중입니다." },
      }),
    ).toBe("✅ 도구 결과: 수동 실행이 진행 중입니다.");
    expect(
      resolveNaverWorksProgressEventTextForTest({
        kind: "command-output",
        payload: { output: "cron run --help" },
      }),
    ).toBe("💻 명령 출력: cron run --help");
    expect(
      resolveNaverWorksProgressEventTextForTest({
        kind: "plan-update",
        payload: { steps: [{ step: "README 수정", status: "in_progress" }] },
      }),
    ).toBe("🧭 진행 중: README 수정");
    expect(
      resolveNaverWorksProgressEventTextForTest({
        kind: "plan-update",
        payload: { explanation: "README를 오전 7시 기준으로 맞추는 중입니다." },
      }),
    ).toBe("🧭 계획 업데이트: README를 오전 7시 기준으로 맞추는 중입니다.");
  });

  it("drops reasoning item lifecycle messages from progress text", () => {
    expect(
      resolveNaverWorksProgressEventTextForTest({
        kind: "item",
        payload: { kind: "reasoning", title: "reasoning", status: "running" },
      }),
    ).toBeUndefined();
  });

  it("switches the third placeholder heartbeat to a long-running notice", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            progressMessages: {
              text: "생각 중입니다...",
              emojis: ["🕒"],
            },
          },
        },
      },
      "default",
    );

    expect(resolveNaverWorksHeartbeatProgressTextForTest(account, 1)).toBe("🕒 생각 중입니다...");
    expect(resolveNaverWorksHeartbeatProgressTextForTest(account, 3)).toBe(
      "🕒 평소보다 응답이 오래 걸립니다. 결과가 오면 알려드리겠습니다.",
    );
    expect(resolveNaverWorksHeartbeatProgressTextForTest(account, 4)).toBe("");
  });
});
