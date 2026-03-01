---
summary: "NAVER WORKS plugin setup for DM-first inbound routing"
title: "NAVER WORKS"
---

# NAVER WORKS (plugin)

Status: **phase 2 (DM-first inbound + outbound text delivery)**.

Current phase focuses on:

- webhook intake for NAVER WORKS events
- DM-only handling (non-direct events are ignored)
- deterministic agent routing by `peer` and optional `teamId`
- outbound text delivery to NAVER WORKS DM when `botId` + `accessToken` are configured

## Install

```bash
openclaw plugins install @openclaw/naverworks
```

Local checkout:

```bash
openclaw plugins install ./extensions/naverworks
```

## Config example

```json5
{
  channels: {
    naverworks: {
      enabled: true,
      webhookPath: "/naverworks/events",
      dmPolicy: "allowlist",
      allowFrom: ["user-U123", "user-U456"],
      strictBinding: true, // default: true (drop messages without a matching binding)
      botId: "your-bot-id",
      accessToken: "xoxb-your-worksmobile-token",
      apiBaseUrl: "https://www.worksapis.com/v1.0", // optional
    },
  },
  bindings: [
    {
      agentId: "nw-u123",
      match: {
        channel: "naverworks",
        teamId: "workspace-A",
        peer: { kind: "direct", id: "user-U123" },
      },
    },
  ],
}
```

## Notes

- Non-direct events are ignored in phase 1 by design.
- `strictBinding` defaults to `true`. When no binding matches, the plugin drops the event instead of falling back to the default agent.
- Set `strictBinding: false` if you want default-agent fallback behavior for unmatched DMs.
- `teamId` matching uses the event payload value from `source.teamId`, `source.domainId`, `source.tenantId`, `teamId`, `domainId`, or `tenantId` (first non-empty value wins).
- To discover the exact `teamId` value for bindings, check gateway logs for lines like `processing inbound event userId=... teamId=...` or `strictBinding dropped event ... teamId=...`, then copy that value into `bindings[].match.teamId`.
- Outbound send endpoint defaults to `https://www.worksapis.com/v1.0/bots/{botId}/users/{userId}/messages`. Override `apiBaseUrl` only if your environment needs a different base URL.
- If `botId` or `accessToken` is missing, inbound still works but outbound replies are skipped with a warning log.
