---
name: yandex-messenger-provider
type: messenger
version: 0.1.0
protocolVersion: 1.0.0
---

# yandex-messenger-provider

Yandex Messenger provider for the `messenger` module.

## Investigation notes (what to use)

Unlike Telegram’s TDLib, a **public, TDLib-like SDK** for Yandex Messenger may not be available in this repository by default.
This provider is structured so you can plug in one of the following approaches (depending on your environment):

- An official HTTP API (if available) with OAuth/API key
- An internal corporate gateway (if you have access)
- A locally running client/bridge that exposes a stable API (TDLib-like architecture)

## Current status

This provider currently runs in **mock mode** by default (returns deterministic fake data).

To switch to a real implementation, set `YANDEX_MESSENGER_PROVIDER_MODE=http` and configure:

- `YANDEX_MESSENGER_API_BASE_URL`
- `YANDEX_MESSENGER_TOKEN`

Providers should cache results under `.cache/barducks/messenger/yandex-messenger-provider/` to avoid unnecessary traffic.

