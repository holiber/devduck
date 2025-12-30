---
name: installer
version: 0.1.0
description: Unified installer for projects and repos (pluggable providers)
tags: [core, installer]
dependencies: [core]
---
# Installer Extension

This extension provides a unified way to **install** projects and repositories from different sources (`src`) into a destination folder (`dest`).

It selects a suitable **installer provider** and delegates installation to it.

