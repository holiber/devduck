---
name: smogcheck-provider
version: 0.1.0
description: Test provider for email module
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
  type: none
  requiredTokens: []
capabilities:
  - read
  - search
  - attachments
---
# Smogcheck Email Provider

Test provider for email module functionality verification.

