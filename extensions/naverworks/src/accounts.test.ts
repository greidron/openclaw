import { describe, expect, it } from "vitest";
import { resolveAccount } from "./accounts.js";

describe("resolveAccount", () => {
  it("defaults strictBinding to true", () => {
    const account = resolveAccount({ channels: { naverworks: {} } }, "default");
    expect(account.strictBinding).toBe(true);
  });

  it("allows strictBinding override per account", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            strictBinding: true,
            accounts: {
              default: {
                strictBinding: false,
              },
            },
          },
        },
      },
      "default",
    );

    expect(account.strictBinding).toBe(false);
  });

  it("resolves outbound credentials with account override", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            botId: "top-bot",
            accessToken: "top-token",
            accounts: {
              default: {
                botId: "acc-bot",
                accessToken: "acc-token",
              },
            },
          },
        },
      },
      "default",
    );

    expect(account.botId).toBe("acc-bot");
    expect(account.accessToken).toBe("acc-token");
    expect(account.apiBaseUrl).toBe("https://www.worksapis.com/v1.0");
    expect(account.tokenUrl).toBe("https://auth.worksmobile.com/oauth2/v2.0/token");
  });

  it("supports JWT auth settings", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            clientId: "client-id",
            clientSecret: "client-secret",
            serviceAccount: "serviceaccount@example.com",
            privateKey: "line1\\nline2",
            scope: "bot user.read",
            jwtIssuer: "issuer-id",
          },
        },
      },
      "default",
    );

    expect(account.clientId).toBe("client-id");
    expect(account.clientSecret).toBe("client-secret");
    expect(account.serviceAccount).toBe("serviceaccount@example.com");
    expect(account.privateKey).toBe("line1\nline2");
    expect(account.scope).toBe("bot user.read");
    expect(account.jwtIssuer).toBe("issuer-id");
  });
  it("resolves botSecret from account-level config", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            botSecret: "top-secret",
            accounts: {
              default: {
                botSecret: "acc-secret",
              },
            },
          },
        },
      },
      "default",
    );

    expect(account.botSecret).toBe("acc-secret");
  });

  it("defaults markdown rendering mode/theme", () => {
    const account = resolveAccount({ channels: { naverworks: {} } }, "default");
    expect(account.markdownMode).toBe("auto-flex");
    expect(account.markdownTheme).toBe("auto");
  });

  it("allows markdown theme override per account", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            markdownTheme: "light",
            accounts: {
              default: {
                markdownTheme: "dark",
              },
            },
          },
        },
      },
      "default",
    );

    expect(account.markdownTheme).toBe("dark");
  });

  it("allows markdownMode override per account", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            markdownMode: "plain",
            accounts: {
              default: {
                markdownMode: "auto-flex",
              },
            },
          },
        },
      },
      "default",
    );

    expect(account.markdownMode).toBe("auto-flex");
  });

  it("merges progressMessages with account override", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            progressMessages: {
              enabled: true,
              text: "처리 중입니다...",
              texts: ["생각 중입니다..."],
              emojis: ["🕒"],
            },
            accounts: {
              default: {
                progressMessages: {
                  intervalMs: 30_000,
                  texts: ["자료를 살펴보는 중입니다..."],
                  emojis: ["🚀"],
                },
              },
            },
          },
        },
      },
      "default",
    );

    expect(account.progressMessages).toEqual({
      enabled: true,
      text: "처리 중입니다...",
      texts: ["생각 중입니다...", "자료를 살펴보는 중입니다..."],
      intervalMs: 30_000,
      emojis: ["🕒", "🚀"],
    });
  });

  it("applies contextual default progress messages when enabled without explicit text", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            progressMessages: {
              enabled: true,
            },
          },
        },
      },
      "default",
    );

    expect(account.progressMessages).toEqual({
      enabled: true,
      text: "생각 중입니다...",
      texts: [
        "생각 중입니다...",
        "답변을 준비하고 있어요...",
        "잠시만요, 확인 중입니다...",
        "자료를 살펴보는 중입니다...",
        "정리해서 답변드릴게요...",
        "내용을 확인하고 있어요...",
        "답변 방향을 잡고 있어요...",
        "필요한 내용을 찾는 중입니다...",
      ],
      intervalMs: 60_000,
      emojis: ["🤔", "🔎", "🧠", "✍️", "💬", "✨", "📚", "🕒"],
    });
  });

  it("enables progress messages by default", () => {
    const account = resolveAccount({ channels: { naverworks: {} } }, "default");

    expect(account.progressMessages).toEqual({
      enabled: true,
      text: "생각 중입니다...",
      texts: [
        "생각 중입니다...",
        "답변을 준비하고 있어요...",
        "잠시만요, 확인 중입니다...",
        "자료를 살펴보는 중입니다...",
        "정리해서 답변드릴게요...",
        "내용을 확인하고 있어요...",
        "답변 방향을 잡고 있어요...",
        "필요한 내용을 찾는 중입니다...",
      ],
      intervalMs: 60_000,
      emojis: ["🤔", "🔎", "🧠", "✍️", "💬", "✨", "📚", "🕒"],
    });
  });

  it("keeps legacy single progress text as the only candidate when texts are omitted", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            progressMessages: {
              text: "확인 중입니다...",
            },
          },
        },
      },
      "default",
    );

    expect(account.progressMessages?.texts).toEqual(["확인 중입니다..."]);
  });

  it("keeps explicit default progress text as a single candidate when texts are omitted", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            progressMessages: {
              text: "생각 중입니다...",
            },
          },
        },
      },
      "default",
    );

    expect(account.progressMessages?.texts).toEqual(["생각 중입니다..."]);
  });

  it("preserves legacy statusStickers opt-out for progress messages", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            statusStickers: {
              enabled: false,
            },
          },
        },
      },
      "default",
    );

    expect(account.progressMessages?.enabled).toBe(false);
  });

  it("resolves debug summary settings with account override", () => {
    const account = resolveAccount(
      {
        channels: {
          naverworks: {
            debugSummary: {
              enabled: true,
              includeCosts: false,
            },
            accounts: {
              default: {
                debugSummary: {
                  includeCosts: true,
                },
              },
            },
          },
        },
      },
      "default",
    );

    expect(account.debugSummary).toEqual({
      enabled: true,
      includeCosts: true,
    });
  });
});
