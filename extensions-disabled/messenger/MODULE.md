# Messenger Module

Messenger module implementing a provider system for chat history and file downloads.

## API

- `listChats` — list available chats
- `getChatHistory` — fetch recent messages for a chat
- `downloadFile` — download a file by ID (returns cached file descriptor)

## Caching

Providers are expected to cache results in `.cache/barducks/messenger/` to avoid unnecessary traffic.

## Provider selection

- `workspace.config.yml`: `moduleSettings.messenger.provider`
- Environment variable: `MESSENGER_PROVIDER`
- Fallback: first available provider (after discovery)

