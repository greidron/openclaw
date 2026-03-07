---
summary: "NAVER WORKS plugin setup for DM-first inbound routing"
title: "NAVER WORKS"
---

# NAVER WORKS (plugin)

Status: **phase 2.5 (DM-first inbound + outbound text/image/audio URL delivery)**.

Current phase focuses on:

- webhook intake for NAVER WORKS events
- DM-only handling (non-direct events are ignored)
- deterministic agent routing by `peer` and optional `teamId`
- outbound text/image/audio URL delivery to NAVER WORKS DM with static token or JWT-based service-account auth

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
      botSecret: "your-bot-secret", // optional but strongly recommended for webhook signature verification
      botId: "your-bot-id",

      // Option A) static token (manual management)
      accessToken: "xoxb-your-worksmobile-token",

      // Option B) JWT service-account auth (recommended)
      clientId: "your-client-id",
      clientSecret: "your-client-secret",
      serviceAccount: "serviceaccount@example.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
      scope: "bot", // optional (default: bot)
      tokenUrl: "https://auth.worksmobile.com/oauth2/v2.0/token", // optional
      jwtIssuer: "your-jwt-issuer", // optional (default: clientId)

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
- Webhook auth: if `botSecret` is set, OpenClaw verifies `X-WORKS-Signature` using HMAC-SHA256 over the raw request body (per NAVER WORKS callback docs).
- Auth options for outbound: static `accessToken`, or JWT (`clientId` + `clientSecret` + `serviceAccount` + `privateKey`).
- If inbound payload has `content.type=image|audio` without text, OpenClaw synthesizes text as `[naverworks:<type>] <url-or-fileId>` so the agent can still process it.
- Outbound media shortcut: send `![alt](https://...)` for image, or `[audio](https://...)` / `[voice](https://...)` for audio URL delivery.
- If outbound auth is not configured, inbound still works but replies are skipped or auth-failed logs are emitted.
