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
});
