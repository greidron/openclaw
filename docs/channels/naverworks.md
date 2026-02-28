---
summary: "NAVER WORKS plugin setup for DM-first inbound routing"
title: "NAVER WORKS"
---

# NAVER WORKS (plugin)

Status: **phase 1 (DM-first inbound routing)**.

This first phase focuses on:

- webhook intake for NAVER WORKS events
- DM-only handling (non-direct events are ignored)
- deterministic agent routing by `peer` and optional `teamId`

## Install

```bash
openclaw plugins install @openclaw/naverworks
```

Local checkout:

```bash
openclaw plugins install ./extensions/naverworks
```

## Phase 1 config example

```json5
{
  channels: {
    naverworks: {
      enabled: true,
      webhookPath: "/naverworks/events",
      dmPolicy: "allowlist",
      allowFrom: ["user-U123", "user-U456"],
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
- Outbound delivery API integration is planned for the next phase.
