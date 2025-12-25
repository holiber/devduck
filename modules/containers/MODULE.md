---
name: containers
version: 0.1.0
description: Docker container orchestration for parallel plan generation
tags: [containers, docker, isolation]
dependencies: [core]
checks:
  - type: "test"
    name: "docker"
    description: "Docker (required for parallel plan generation). Installation is skipped if running inside Docker container."
    test: "sh -c 'test ! -f /.dockerenv && command -v docker >/dev/null 2>&1 && docker --version'"
    install: "sh -c 'if [ -f /.dockerenv ]; then echo \"Skipping Docker installation: running inside container\"; exit 0; fi; if command -v brew >/dev/null 2>&1; then brew install --cask docker; else echo \"Please install Docker Desktop from https://www.docker.com/products/docker-desktop\"; exit 1; fi'"
    docs: "https://docs.docker.com/get-docker/"
---
# Containers Module

This module provides Docker-based container orchestration used for parallel plan generation and isolation workflows.

