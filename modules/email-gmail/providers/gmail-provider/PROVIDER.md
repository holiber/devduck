---
name: gmail-provider
version: 0.1.0
description: Gmail provider for email module (Gmail API)
protocolVersion: 1.0.0
tools:
  - getMessage
  - searchMessages
  - downloadAttachment
  - listUnreadMessages
events:
  publish: []
  subscribe: []
auth:
  type: oauth2
  requiredTokens:
    - GMAIL_ACCESS_TOKEN
capabilities:
  - read
  - search
  - attachments
---
# Gmail Email Provider

Provider for the `email` module backed by the Gmail API.

## Configuration

Set environment variable `GMAIL_ACCESS_TOKEN` to a valid OAuth2 access token with Gmail scopes.

