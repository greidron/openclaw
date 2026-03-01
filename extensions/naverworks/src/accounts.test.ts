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
});
