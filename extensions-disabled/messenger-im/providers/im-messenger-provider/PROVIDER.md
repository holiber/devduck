---
name: im-messenger-provider
type: messenger
version: 0.1.0
protocolVersion: 1.0.0
---

# im-messenger-provider

IM provider for the `messenger` module.

## Investigation notes (what to use)

Unlike some chat ecosystems, a **public, TDLib-like SDK** for this IM service may not be available in this repository by default.
This provider is structured so you can plug in one of the following approaches (depending on your environment):

- An official HTTP API (if available) with OAuth/API key
- An internal corporate gateway (if you have access)
- A locally running client/bridge that exposes a stable API (TDLib-like architecture)

## Current status

This provider currently runs in **mock mode** by default (returns deterministic fake data).

To switch to a real implementation, set `IM_MESSENGER_PROVIDER_MODE=http` and configure:

- `IM_MESSENGER_API_BASE_URL`
- `IM_MESSENGER_TOKEN`

Providers should cache results under `.cache/barducks/messenger/im-messenger-provider/` to avoid unnecessary traffic.

