import { describe, expect, it } from "vitest";
import { parseNaverWorksInbound } from "./webhook-handler.js";

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
});
