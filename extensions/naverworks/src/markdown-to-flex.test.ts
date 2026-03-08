import { describe, expect, it } from "vitest";
import { hasMarkdownFeatures, markdownToNaverWorksFlexTemplate } from "./markdown-to-flex.js";

describe("markdownToNaverWorksFlexTemplate", () => {
  it("returns null when text is plain", () => {
    expect(markdownToNaverWorksFlexTemplate("hello world")).toBeNull();
    expect(hasMarkdownFeatures("hello world")).toBe(false);
  });

  it("converts markdown heading/list/link into flex bubble", () => {
    const payload = markdownToNaverWorksFlexTemplate(
      "# Status\n- item one\n- item two\nSee [OpenClaw](https://openclaw.ai)",
    );

    expect(payload).toBeTruthy();
    expect(payload?.contents.type).toBe("bubble");
    expect(JSON.stringify(payload)).toContain("Status");
    expect(JSON.stringify(payload)).toContain("• item one");
    expect(JSON.stringify(payload)).toContain("OpenClaw (https://openclaw.ai)");
  });

  it("includes table and code sections in the output", () => {
    const payload = markdownToNaverWorksFlexTemplate(
      [
        "| Key | Value |",
        "| --- | --- |",
        "| mode | auto-flex |",
        "",
        "```ts",
        "console.log('ok')",
        "```",
      ].join("\n"),
    );

    expect(payload).toBeTruthy();
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("Table");
    expect(serialized).toContain("Code (ts)");
    expect(serialized).toContain("Key: mode | Value: auto-flex");
  });
});
