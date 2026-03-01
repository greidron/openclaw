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
  });
});
