---
name: telegram-provider
type: messenger
version: 0.1.0
protocolVersion: 1.0.0
---

# telegram-provider

Telegram provider for the `messenger` module.

## Recommended implementation: TDLib

Telegram’s **TDLib** is a good option for stable, low-level access. A production implementation of this provider is expected to:

- Run TDLib client (native library) and expose a small adapter layer in Node.js
- Implement `getChatHistory` and `downloadFile`
- Cache results under `.cache/devduck/messenger/telegram-provider/` to avoid unnecessary traffic

## Current status

This provider currently runs in **mock mode** by default (returns deterministic fake data).

To switch to a real implementation, set `TELEGRAM_PROVIDER_MODE=tdlib` and provide TDLib configuration (to be implemented):

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_PHONE` (or bot token if you choose a bot-based approach)

